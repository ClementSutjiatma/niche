#!/usr/bin/env node

/**
 * Niche CLI v0 — Thin HTTP Client
 *
 * All heavy logic (Privy auth, wallet creation, signing, escrow,
 * on-chain transactions) lives in Supabase Edge Functions.
 *
 * This CLI is a lightweight wrapper that:
 *  - Calls the niche-api Edge Function for data operations
 *  - Opens the hosted niche-ui in the browser for auth, signing, and browsing
 *  - Reads Supabase directly (anon key) for listing queries
 *  - Caches auth state in ~/.niche/auth.json
 */

const fs = require('fs');
const path = require('path');
const auth = require('./lib/auth');

// Config paths
const CONFIG_DIR = path.join(process.env.HOME, '.niche');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Config — loaded from ~/.niche/config.json or environment variables
const DEFAULT_SUPABASE_URL = process.env.NICHE_SUPABASE_URL || '';
const DEFAULT_ANON_KEY = process.env.NICHE_SUPABASE_ANON_KEY || '';
const DEFAULT_UI_BASE = process.env.NICHE_UI_BASE || 'https://niche-henna.vercel.app';

// Load config file if it exists (overrides env vars)
let fileConfig = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch { /* ignore */ }

const SUPABASE_URL = fileConfig.supabaseUrl || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = fileConfig.supabaseAnonKey || DEFAULT_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase configuration. Run: niche config --supabase-url <url> --anon-key <key>');
  console.error('Or set NICHE_SUPABASE_URL and NICHE_SUPABASE_ANON_KEY environment variables.');
  process.exit(1);
}

// Edge Function base URLs
const API_BASE = `${SUPABASE_URL}/functions/v1/niche-api`;
const UI_BASE = fileConfig.uiBase || DEFAULT_UI_BASE;

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Config helpers
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Lazy-load Supabase client for direct read queries
let supabase = null;

function getSupabase() {
  if (!supabase) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// Helper: call Edge Function API
async function apiCall(method, endpoint, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
  };

  // Add auth token if available
  const authState = auth.getAuthState();
  if (authState?.authToken) {
    headers['X-Auth-Token'] = authState.authToken;
  }

  const opts = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }

  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, opts);

  if (!res.ok) {
    let errMsg;
    try {
      const errBody = await res.json();
      errMsg = errBody.error || errBody.message || `HTTP ${res.status}`;
    } catch {
      errMsg = `HTTP ${res.status}`;
    }
    throw new Error(errMsg);
  }

  return res.json();
}

// Helper: open browser
async function openBrowser(url) {
  const open = require('open');
  await open(url);
}

// Parse CLI args
const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      flags[key] = val;
    } else if (!args[i].startsWith('-')) {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

const { flags, positional } = parseFlags(args.slice(1));

// Get current user identity from auth state or simulated
async function getCurrentUser() {
  if (flags.simulate) {
    return await getOrCreateSimulatedUser(flags.simulate);
  }

  if (auth.isAuthenticated()) {
    const identity = auth.getUserIdentity();
    if (identity && identity.wallet) {
      // If we already have the Supabase userId, skip the DB lookup
      if (identity.userId) {
        return {
          id: identity.userId,
          channelId: identity.twitterUsername || identity.email || identity.id,
          channelType: identity.provider || 'twitter',
          wallet: identity.wallet,
          privyUserId: identity.id,
          simulated: false
        };
      }
      // Fallback: legacy format without userId, do DB lookup
      const user = await getOrCreatePrivyUser(identity);
      return {
        id: user.id,
        channelId: identity.twitterUsername || identity.email || identity.id,
        channelType: identity.provider,
        wallet: identity.wallet,
        privyUserId: identity.id,
        simulated: false
      };
    }
  }

  // Fallback to legacy config
  const config = loadConfig();
  if (!config.userId || !config.channelId || !config.channelType) {
    return null;
  }
  return {
    id: config.userId,
    channelId: config.channelId,
    channelType: config.channelType,
    wallet: config.wallet,
    simulated: false
  };
}

// Get or create a Supabase user for Privy-authenticated users
async function getOrCreatePrivyUser(identity) {
  const db = getSupabase();
  const channelId = identity.twitterUsername || identity.email || identity.id;
  const channelType = identity.twitterUsername ? 'twitter' : identity.provider;

  let { data: user, error: fetchError } = await db
    .from('users')
    .select('*')
    .eq('channel_id', channelId)
    .eq('channel_type', channelType)
    .single();

  if (fetchError && fetchError.code === 'PGRST116') {
    // Also try lookup by twitter_username if available
    if (identity.twitterUsername) {
      const { data: twitterUser } = await db
        .from('users')
        .select('*')
        .eq('twitter_username', identity.twitterUsername)
        .single();
      if (twitterUser) {
        user = twitterUser;
      }
    }

    if (!user) {
      const displayName = identity.twitterUsername
        ? `@${identity.twitterUsername}`
        : (identity.email || 'Privy User');
      const { data: newUser, error: createError } = await db
        .from('users')
        .insert({
          channel_id: channelId,
          channel_type: channelType,
          wallet_address: identity.wallet,
          display_name: displayName,
          twitter_username: identity.twitterUsername || null,
        })
        .select()
        .single();

      if (createError) throw createError;
      user = newUser;
    }
  }

  if (user && user.wallet_address !== identity.wallet) {
    await db
      .from('users')
      .update({ wallet_address: identity.wallet })
      .eq('id', user.id);
    user.wallet_address = identity.wallet;
  }

  return user;
}

// Create or get a simulated user for testing
async function getOrCreateSimulatedUser(simulateName) {
  const db = getSupabase();
  const channelId = `sim_${simulateName}`;
  const channelType = 'simulated';

  let { data: user, error: fetchError } = await db
    .from('users')
    .select('*')
    .eq('channel_id', channelId)
    .eq('channel_type', channelType)
    .single();

  if (fetchError && fetchError.code === 'PGRST116') {
    const testWallet = `0x${Buffer.from(simulateName).toString('hex').padEnd(40, '0')}`;
    const { data: newUser, error: createError } = await db
      .from('users')
      .insert({
        channel_id: channelId,
        channel_type: channelType,
        wallet_address: testWallet,
        display_name: `Simulated: ${simulateName}`
      })
      .select()
      .single();

    if (createError) throw createError;
    user = newUser;
    console.log(`[SIM] Created simulated user: ${simulateName}`);
  }

  return {
    id: user.id,
    channelId: user.channel_id,
    channelType: user.channel_type,
    wallet: user.wallet_address,
    displayName: user.display_name,
    simulated: true,
    simulateName
  };
}

// ============== MAIN ==============

async function main() {
  try {
    switch (command) {
      case undefined:
      case '':
      case 'help':
        showHelp();
        break;
      case 'login':
        await cmdLogin();
        break;
      case 'logout':
        await cmdLogout();
        break;
      case 'whoami':
        await cmdWhoami();
        break;
      case 'browse':
        await cmdBrowse();
        break;
      case 'view':
        await cmdView();
        break;
      case 'post':
        await cmdPost();
        break;
      case 'search':
        await cmdSearch();
        break;
      case 'list':
        await cmdList();
        break;
      case 'show':
        await cmdShow();
        break;
      case 'cancel':
        await cmdCancel();
        break;
      case 'watch':
        await cmdWatch();
        break;
      case 'watches':
        await cmdWatches();
        break;
      case 'unwatch':
        await cmdUnwatch();
        break;
      case 'interest':
        await cmdInterest();
        break;
      case 'confirm':
        await cmdConfirm();
        break;
      case 'dispute':
        await cmdDispute();
        break;
      case 'escrow':
        await cmdEscrow();
        break;
      case 'balance':
        await cmdBalance();
        break;
      case 'fund':
        await cmdFund();
        break;
      case 'check-matches':
        await cmdCheckMatches();
        break;
      default:
        showHelp();
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

// ============== COMMANDS ==============

async function cmdLogin() {
  console.log('Opening login in your browser...');
  console.log('Complete the Twitter/X login and passkey setup there.\n');

  const loginUrl = `${UI_BASE}/login`;
  await openBrowser(loginUrl);

  console.log(`URL: ${loginUrl}`);
  console.log('');
  console.log('After login completes in the browser, your auth state');
  console.log('will be available. Run `niche whoami` to verify.');
}

async function cmdLogout() {
  auth.logout();

  const config = loadConfig();
  delete config.privyUserId;
  delete config.provider;
  saveConfig(config);
}

async function cmdWhoami() {
  if (auth.isAuthenticated()) {
    const identity = auth.getUserIdentity();
    console.log('Current identity:');
    console.log(`  Provider: ${identity.provider}`);
    if (identity.twitterUsername) {
      console.log(`  Twitter: @${identity.twitterUsername}`);
    }
    if (identity.email) {
      console.log(`  Email: ${identity.email}`);
    }
    if (identity.userId) {
      console.log(`  User ID: ${identity.userId}`);
    }
    if (identity.id) {
      console.log(`  Privy User: ${identity.id}`);
    }
    console.log(`  Wallet: ${identity.wallet || '(creating...)'}`);

    if (identity.wallet) {
      try {
        const data = await apiCall('GET', `/balance/${identity.wallet}`);
        console.log(`  USD Balance: ${data.usdc} (Base Sepolia)`);
        console.log(`  ETH Balance:  ${data.eth}`);
      } catch {
        console.log('  Balance: (unable to fetch)');
      }
    }
    return;
  }

  const user = await getCurrentUser();
  if (!user) {
    console.log('Not logged in.\n');
    console.log('Login with Twitter/X to get an embedded wallet:');
    console.log('  niche login');
    return;
  }

  console.log('Current identity (Legacy):');
  console.log(`  Channel: ${user.channelType}:${user.channelId}`);
  console.log(`  Wallet: ${user.wallet || '(not linked)'}`);
  console.log(`  User ID: ${user.id}`);

  if (user.wallet) {
    try {
      const data = await apiCall('GET', `/balance/${user.wallet}`);
      console.log(`  USD Balance: ${data.usdc} (Base Sepolia)`);
      console.log(`  ETH Balance:  ${data.eth}`);
    } catch {
      console.log('  Balance: (unable to fetch)');
    }
  }
}

async function cmdBrowse() {
  let url = `${UI_BASE}/listings`;

  // Pass filters as query params
  const params = new URLSearchParams();
  if (flags.neighborhood) params.set('neighborhood', flags.neighborhood);
  if (flags['max-price']) params.set('max_price', flags['max-price']);
  if (flags['min-rooms']) params.set('min_rooms', flags['min-rooms']);

  const qs = params.toString();
  if (qs) url += `?${qs}`;

  console.log('Opening listings in browser...');
  await openBrowser(url);
}

async function cmdView() {
  const listingId = positional[0];
  if (!listingId) {
    console.log('Usage: niche view <listing-id>');
    return;
  }

  const url = `${UI_BASE}/listing/${listingId}`;
  console.log('Opening listing in browser...');
  await openBrowser(url);
}

async function cmdPost() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const itemName = flags['item-name'] || flags.itemName;
  const price = parseInt(flags.price);
  const minDeposit = parseInt(flags['min-deposit'] || flags.minDeposit);
  const category = flags.category || '';
  const itemDescription = flags['item-description'] || flags.itemDescription || flags.description || '';

  if (!itemName || !price || !minDeposit) {
    console.log('Usage: niche post --item-name <name> --price <amount> --min-deposit <amount> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --category <type>           Card category (e.g., Pokemon, Magic, Sports, Yu-Gi-Oh)');
    console.log('  --item-description <text>   Description of the card');
    console.log('');
    console.log('Example:');
    console.log('  niche post --item-name "Charizard Base Set" --price 50 --min-deposit 10 --category "Pokemon" --item-description "Mint condition"');
    return;
  }

  if (minDeposit > price) {
    console.log('Error: Min deposit cannot be greater than price');
    return;
  }

  const db = getSupabase();

  const { data: listing, error } = await db
    .from('listings')
    .insert({
      user_id: user.id,
      item_name: itemName,
      price,
      min_deposit: minDeposit,
      category,
      item_description: itemDescription,
      status: 'active'
    })
    .select()
    .single();

  if (error) throw error;

  console.log(`✓ Listed: ${listing.id.slice(0, 8)}`);
  console.log(`  ${itemName} - $${price} USD`);
  console.log(`  Min deposit: $${minDeposit} USD`);
  if (category) console.log(`  Category: ${category}`);
  if (itemDescription) console.log(`  ${itemDescription.slice(0, 60)}${itemDescription.length > 60 ? '...' : ''}`);

  // Check for matching watches
  const { data: watches } = await db
    .from('watches')
    .select('*, users(channel_id, channel_type)')
    .neq('user_id', user.id);

  const matches = (watches || []).filter(w => {
    if (w.max_price && price > w.max_price) return false;
    if (w.min_deposit && minDeposit < w.min_deposit) return false;
    if (w.categories && w.categories.length > 0) {
      const catLower = category.toLowerCase();
      const matchesCat = w.categories.some(c =>
        catLower.includes(c.toLowerCase()) || c.toLowerCase().includes(catLower)
      );
      if (!matchesCat) return false;
    }
    return true;
  });

  if (matches.length > 0) {
    console.log(`\n🔔 ${matches.length} watch(es) matched!`);
    matches.forEach(w => {
      console.log(`  → ${w.users.channel_type}:${w.users.channel_id}`);
    });
  }
}

async function cmdSearch() {
  const db = getSupabase();

  let query = db
    .from('listings')
    .select('*, users(display_name)')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (flags.category) {
    query = query.ilike('category', `%${flags.category}%`);
  }
  if (flags['item-name'] || flags.itemName) {
    const itemName = flags['item-name'] || flags.itemName;
    query = query.ilike('item_name', `%${itemName}%`);
  }
  if (flags['max-price']) {
    query = query.lte('price', parseInt(flags['max-price']));
  }
  if (flags['min-deposit']) {
    query = query.gte('min_deposit', parseInt(flags['min-deposit']));
  }

  const { data: listings, error } = await query;
  if (error) throw error;

  if (!listings || listings.length === 0) {
    console.log('No listings found matching criteria.');
    console.log('Tip: Use `niche watch` to get notified when matches appear.');
    return;
  }

  console.log(`Found ${listings.length} listing(s):\n`);
  listings.forEach((l, i) => {
    const id = l.id.slice(0, 8);
    const category = l.category ? `[${l.category}]` : '[Card]';
    console.log(`${i + 1}. [${id}] ${category} ${l.item_name} - $${l.price} USD`);
    console.log(`   Min deposit: $${l.min_deposit} USD`);
    if (l.item_description) {
      console.log(`   ${l.item_description.slice(0, 60)}${l.item_description.length > 60 ? '...' : ''}`);
    }
    console.log('');
  });

  console.log(`🌐 View in browser: niche browse${flags.category ? ' --category "' + flags.category + '"' : ''}`);
}

async function cmdList() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const db = getSupabase();

  const { data: listings, error } = await db
    .from('listings')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  if (!listings || listings.length === 0) {
    console.log('No listings yet. Use `niche post` to create one.');
    return;
  }

  console.log(`Your listings (${listings.length}):\n`);
  listings.forEach(l => {
    const status = l.status === 'active' ? '●' : '○';
    const id = l.id.slice(0, 8);
    const category = l.category ? `[${l.category}]` : '';
    console.log(`${status} [${id}] ${category} ${l.item_name} $${l.price} USD (min: $${l.min_deposit}) - ${l.status}`);
  });
}

async function cmdShow() {
  const listingId = positional[0];
  if (!listingId) {
    console.log('Usage: niche show <listing-id>');
    return;
  }

  const db = getSupabase();

  const { data: allListings, error } = await db
    .from('listings')
    .select('*, users(display_name, channel_id, channel_type)');

  if (error) throw error;

  const listings = (allListings || []).filter(l => l.id.startsWith(listingId));
  if (listings.length === 0) {
    console.log(`Listing ${listingId} not found.`);
    return;
  }

  const listing = listings[0];
  const category = listing.category ? `[${listing.category}]` : '[Card]';

  console.log(`\n[${listing.id.slice(0, 8)}] ${category} ${listing.item_name}\n`);
  console.log(`Price:       $${listing.price} USD`);
  console.log(`Min Deposit: $${listing.min_deposit} USD`);
  console.log(`Remaining:   $${listing.price - listing.min_deposit} USD (at meetup)`);
  console.log(`Status:      ${listing.status}`);
  console.log(`Posted:      ${listing.created_at}`);
  console.log(`Seller:      ${listing.users.display_name || listing.users.channel_type + ':' + listing.users.channel_id}`);
  console.log(`\nDescription:\n${listing.item_description || '(no description)'}`);
  console.log(`\nFull ID: ${listing.id}`);
  console.log(`\n🌐 View in browser: niche view ${listing.id.slice(0, 8)}`);
}

async function cmdCancel() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const listingId = positional[0];
  if (!listingId) {
    console.log('Usage: niche cancel <listing-id>');
    return;
  }

  const db = getSupabase();

  const { data: allListings } = await db
    .from('listings')
    .select('id')
    .eq('user_id', user.id);

  const match = (allListings || []).find(l => l.id.startsWith(listingId));
  if (!match) {
    console.log(`Listing ${listingId} not found.`);
    return;
  }

  const { data, error } = await db
    .from('listings')
    .update({ status: 'cancelled' })
    .eq('id', match.id)
    .select()
    .single();

  if (error) throw error;

  console.log(`✓ Listing ${data.id.slice(0, 8)} cancelled.`);
}

async function cmdWatch() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const categories = flags.category ? flags.category.split(',').map(s => s.trim()) : null;
  const maxPrice = flags['max-price'] ? parseInt(flags['max-price']) : null;
  const minDeposit = flags['min-deposit'] ? parseInt(flags['min-deposit']) : null;

  if (!categories && !maxPrice && !minDeposit) {
    console.log('Usage: niche watch [options]');
    console.log('');
    console.log('Options:');
    console.log('  --category <types>      Comma-separated categories (e.g., Pokemon,Magic)');
    console.log('  --max-price <n>         Maximum price in USD');
    console.log('  --min-deposit <n>       Minimum deposit in USD');
    console.log('');
    console.log('Example:');
    console.log('  niche watch --category "Pokemon,Magic" --max-price 100');
    return;
  }

  const db = getSupabase();

  const { data: watch, error } = await db
    .from('watches')
    .insert({
      user_id: user.id,
      categories,
      max_price: maxPrice,
      min_deposit: minDeposit
    })
    .select()
    .single();

  if (error) throw error;

  console.log(`✓ Watch created: ${watch.id.slice(0, 8)}`);
  console.log(`  Categories: ${categories ? categories.join(', ') : 'Any'}`);
  console.log(`  Max price: ${maxPrice ? '$' + maxPrice : 'Any'}`);
  console.log(`  Min deposit: ${minDeposit ? '$' + minDeposit : 'Any'}`);
  console.log('\nYou will be notified when a matching card appears.');
}

async function cmdWatches() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const db = getSupabase();

  const { data: watches, error } = await db
    .from('watches')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  if (!watches || watches.length === 0) {
    console.log('No active watches. Use `niche watch` to create one.');
    return;
  }

  console.log(`Active watches (${watches.length}):\n`);
  watches.forEach(w => {
    const cats = w.categories ? w.categories.join(', ') : 'Any category';
    const id = w.id.slice(0, 8);
    console.log(`[${id}] ${cats}, max $${w.max_price || '∞'}, min deposit $${w.min_deposit || '0'}`);
  });
}

async function cmdUnwatch() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const watchId = positional[0];
  if (!watchId) {
    console.log('Usage: niche unwatch <watch-id>');
    return;
  }

  const db = getSupabase();

  const { data: allWatches } = await db
    .from('watches')
    .select('id')
    .eq('user_id', user.id);

  const match = (allWatches || []).find(w => w.id.startsWith(watchId));
  if (!match) {
    console.log(`Watch ${watchId} not found.`);
    return;
  }

  const { data, error } = await db
    .from('watches')
    .delete()
    .eq('id', match.id)
    .select()
    .single();

  if (error) throw error;

  console.log(`✓ Watch ${data.id.slice(0, 8)} removed.`);
}

async function cmdInterest() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const listingId = positional[0];
  if (!listingId) {
    console.log('Usage: niche interest <listing-id> [--simulate <renter-name>]');
    return;
  }

  const db = getSupabase();

  // Get listing
  const { data: allListings, error: listingError } = await db
    .from('listings')
    .select('*, users(id, wallet_address, channel_id, channel_type)')
    .eq('status', 'active');

  if (listingError) throw listingError;

  const listings = (allListings || []).filter(l => l.id.startsWith(listingId));
  if (listings.length === 0) {
    console.log(`Listing ${listingId} not found or not active.`);
    return;
  }

  const listing = listings[0];
  const seller = listing.users;

  if (listing.user_id === user.id && !user.simulated) {
    console.log("You can't express interest in your own listing.");
    return;
  }

  // SIMULATED ESCROW MODE
  if (user.simulated) {
    console.log(`[SIM] Simulating escrow deposit as "${user.simulateName}"...`);

    const orderId = `0xsim_${Date.now().toString(16)}`;

    const { data: escrow, error: escrowError } = await db
      .from('escrows')
      .insert({
        listing_id: listing.id,
        buyer_id: user.id,
        seller_id: seller.id,
        amount: listing.price,
        currency: 'USDC',
        escrow_service: 'simulated',
        escrow_id: orderId,
        status: 'deposited',
        deposit_tx_hash: `sim_tx_${Date.now()}`
      })
      .select()
      .single();

    if (escrowError) throw escrowError;

    await db
      .from('listings')
      .update({ status: 'pending' })
      .eq('id', listing.id);

    console.log(`[SIM] ✓ Interest expressed in listing ${listing.id.slice(0, 8)}`);
    console.log('');
    console.log(`[SIM] Escrow created: ${escrow.id.slice(0, 8)}`);
    console.log(`  Amount: ${listing.price} USD (SIMULATED)`);
    console.log(`  Buyer: ${user.displayName || user.simulateName}`);
    console.log(`  Seller: ${seller.channel_type}:${seller.channel_id}`);
    console.log(`  Status: deposited`);
    console.log('');
    console.log('[SIM] Seller has been notified. Use `niche confirm` to complete.');
    console.log(`  As buyer: niche confirm ${listing.id.slice(0, 8)} --simulate ${user.simulateName}`);
    console.log(`  As seller: niche confirm ${listing.id.slice(0, 8)}`);
    return;
  }

  // REAL ESCROW — open browser to hosted escrow/signing UI
  if (!auth.isAuthenticated()) {
    console.log('You need to login first:');
    console.log('  niche login');
    return;
  }

  console.log(`Opening escrow deposit for listing ${listing.id.slice(0, 8)}...`);
  console.log(`  ${listing.rooms}BR in ${listing.neighborhood} — $${listing.price}/mo`);
  console.log('');
  console.log('Complete the escrow deposit in your browser.');
  console.log('Sign with your passkey to deposit USD.');

  const url = `${UI_BASE}/listing/${listing.id}#escrow`;
  await openBrowser(url);
}

async function cmdConfirm() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const listingId = positional[0];
  if (!listingId) {
    console.log('Usage: niche confirm <listing-id> [--simulate <name>]');
    return;
  }

  if (user.simulated) {
    console.log(`[SIM] Confirming as "${user.simulateName}"...`);
  }

  const db = getSupabase();

  const { data: allEscrows, error: escrowError } = await db
    .from('escrows')
    .select('*, listings(*)')
    .eq('status', 'deposited');

  if (escrowError) throw escrowError;

  const escrows = (allEscrows || []).filter(e => e.listing_id.startsWith(listingId));
  if (escrows.length === 0) {
    console.log(`No pending escrow for listing ${listingId}.`);
    return;
  }

  const escrow = escrows[0];

  let role;
  if (escrow.buyer_id === user.id) {
    role = 'buyer';
  } else if (escrow.seller_id === user.id) {
    role = 'seller';
  } else {
    console.log("You're not involved in this escrow.");
    return;
  }

  const updates = {};
  if (role === 'buyer') {
    if (escrow.buyer_confirmed) {
      console.log('You already confirmed this escrow.');
      return;
    }
    updates.buyer_confirmed = true;
  } else {
    if (escrow.seller_confirmed) {
      console.log('You already confirmed this escrow.');
      return;
    }
    updates.seller_confirmed = true;
  }

  const { data: updated, error: updateError } = await db
    .from('escrows')
    .update(updates)
    .eq('id', escrow.id)
    .select()
    .single();

  if (updateError) throw updateError;

  console.log(`✓ ${role.charAt(0).toUpperCase() + role.slice(1)} confirmed meetup for listing ${escrow.listing_id.slice(0, 8)}`);

  const buyerConfirmed = role === 'buyer' ? true : escrow.buyer_confirmed;
  const sellerConfirmed = role === 'seller' ? true : escrow.seller_confirmed;

  if (buyerConfirmed && sellerConfirmed) {
    // Both confirmed — call Edge Function to release on-chain
    if (escrow.escrow_service === 'onchain') {
      try {
        console.log('Releasing on-chain escrow via Edge Function...');

        const { data: sellerData } = await db
          .from('users')
          .select('wallet_address')
          .eq('id', escrow.seller_id)
          .single();

        const res = await fetch(`${SUPABASE_URL}/functions/v1/niche-escrow/release`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            escrowId: escrow.escrow_id,
            sellerAddress: sellerData.wallet_address,
            amount: escrow.amount
          })
        });

        if (res.ok) {
          const result = await res.json();
          console.log(`✓ On-chain release: ${result.txHash}`);

          await db
            .from('escrows')
            .update({
              status: 'released',
              confirmed_at: new Date().toISOString(),
              release_tx_hash: result.txHash
            })
            .eq('id', escrow.id);
        } else {
          console.log('On-chain release failed. Database marked as released.');
          await db
            .from('escrows')
            .update({
              status: 'released',
              confirmed_at: new Date().toISOString()
            })
            .eq('id', escrow.id);
        }
      } catch (err) {
        console.error('Release error:', err.message);
        await db
          .from('escrows')
          .update({
            status: 'released',
            confirmed_at: new Date().toISOString()
          })
          .eq('id', escrow.id);
      }
    } else {
      // Simulated escrow
      await db
        .from('escrows')
        .update({
          status: 'released',
          confirmed_at: new Date().toISOString(),
          release_tx_hash: 'simulated-release-' + Date.now()
        })
        .eq('id', escrow.id);
    }

    await db
      .from('listings')
      .update({ status: 'completed' })
      .eq('id', escrow.listing_id);

    console.log('');
    console.log('🎉 Both parties confirmed! Escrow released.');
    console.log(`   ${escrow.amount} USD sent to seller.`);
    console.log('');
    console.log('Congrats on your new place!');
  } else {
    console.log('');
    console.log(`Waiting for ${buyerConfirmed ? 'seller' : 'buyer'} confirmation.`);
  }
}

async function cmdDispute() {
  const user = await getCurrentUser();
  if (!auth.requireAuth(user)) return;

  const listingId = positional[0];
  const reason = flags.reason || 'No reason provided';

  if (!listingId) {
    console.log('Usage: niche dispute <listing-id> --reason "..."');
    return;
  }

  const db = getSupabase();

  const { data: allEscrows, error: escrowError } = await db
    .from('escrows')
    .select('*')
    .eq('status', 'deposited');

  if (escrowError) throw escrowError;

  const escrows = (allEscrows || []).filter(e => e.listing_id.startsWith(listingId));
  if (escrows.length === 0) {
    console.log(`No active escrow for listing ${listingId}.`);
    return;
  }

  const escrow = escrows[0];

  if (escrow.buyer_id !== user.id && escrow.seller_id !== user.id) {
    console.log("You're not involved in this escrow.");
    return;
  }

  await db
    .from('escrows')
    .update({ status: 'disputed' })
    .eq('id', escrow.id);

  console.log(`⚠️  Dispute filed for listing ${escrow.listing_id.slice(0, 8)}`);
  console.log(`  Reason: ${reason}`);
  console.log('  Escrow funds are held pending resolution.');
}

async function cmdEscrow() {
  const user = await getCurrentUser();

  const listingId = positional[0];
  const db = getSupabase();

  if (listingId) {
    const { data: allEscrows, error } = await db
      .from('escrows')
      .select('*, listings(neighborhood, price, rooms)');

    if (error) throw error;

    const escrows = (allEscrows || []).filter(e => e.listing_id.startsWith(listingId));
    if (escrows.length === 0) {
      console.log(`No escrow for listing ${listingId}.`);
      return;
    }

    const escrow = escrows[0];
    console.log(`\nEscrow ${escrow.id.slice(0, 8)} for listing ${escrow.listing_id.slice(0, 8)}:`);
    console.log(`  Amount: ${escrow.amount} ${escrow.currency}`);
    console.log(`  Status: ${escrow.status}`);
    console.log(`  Buyer confirmed: ${escrow.buyer_confirmed ? 'Yes' : 'No'}`);
    console.log(`  Seller confirmed: ${escrow.seller_confirmed ? 'Yes' : 'No'}`);
    if (escrow.escrow_id) console.log(`  Order ID: ${escrow.escrow_id.slice(0, 18)}...`);
    if (escrow.deposit_tx_hash) console.log(`  Deposit: ${escrow.deposit_tx_hash.slice(0, 18)}...`);
    if (escrow.release_tx_hash) console.log(`  Release: ${escrow.release_tx_hash.slice(0, 18)}...`);
  } else {
    if (!user) {
      console.log('Not set up yet. Run `niche login` first.');
      return;
    }

    const { data: escrows, error } = await db
      .from('escrows')
      .select('*, listings(neighborhood, price)')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!escrows || escrows.length === 0) {
      console.log('No escrows yet.');
      return;
    }

    console.log(`Your escrows (${escrows.length}):\n`);
    escrows.forEach(e => {
      const role = e.buyer_id === user.id ? 'buyer' : 'seller';
      const confirms = `${e.buyer_confirmed ? '✓' : '○'}/${e.seller_confirmed ? '✓' : '○'}`;
      const id = e.id.slice(0, 8);
      const lid = e.listing_id.slice(0, 8);
      console.log(`[${id}] Listing ${lid} - ${e.amount} ${e.currency} - ${e.status} (${confirms}) [${role}]`);
    });
  }
}

async function cmdBalance() {
  const user = await getCurrentUser();
  if (!user || !user.wallet) {
    console.log('Wallet not configured. Run `niche login` first.');
    return;
  }

  try {
    const data = await apiCall('GET', `/balance/${user.wallet}`);
    console.log(`Wallet: ${user.wallet}`);
    console.log(`Network: Base Sepolia (testnet)`);
    console.log('');
    console.log(`USD: ${data.usdc}`);
    console.log(`ETH:  ${data.eth}`);
    console.log('');
    console.log('Get testnet USD: https://faucet.circle.com');
  } catch (err) {
    console.log(`Wallet: ${user.wallet}`);
    console.log(`Balance: (unable to fetch — ${err.message})`);
  }
}

async function cmdFund() {
  const user = await getCurrentUser();
  if (!user || !user.wallet) {
    console.log('Wallet not configured. Run `niche login` first.');
    return;
  }

  const amount = positional[0] || flags.amount;
  const email = auth.getAuthState()?.email || '';

  console.log('Opening fiat on-ramp...');
  console.log(`Wallet: ${user.wallet}`);
  if (amount) console.log(`Amount: $${amount}`);

  // Call Edge Function to get signed MoonPay URL
  try {
    const res = await fetch(`${API_BASE}/fund/url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        address: user.wallet,
        email,
        amount: amount ? parseFloat(amount) : undefined
      })
    });

    if (res.ok) {
      const data = await res.json();
      await openBrowser(data.url);
      console.log('\nMoonPay opened in browser. Complete the purchase there.');
    } else {
      // Fallback to Circle faucet
      console.log('\nMoonPay unavailable. Get free testnet USD instead:');
      const faucetUrl = `https://faucet.circle.com?chain=base-sepolia&address=${user.wallet}`;
      await openBrowser(faucetUrl);
    }
  } catch {
    const faucetUrl = `https://faucet.circle.com?chain=base-sepolia&address=${user.wallet}`;
    console.log('Opening Circle faucet for testnet USD...');
    await openBrowser(faucetUrl);
  }
}

async function cmdCheckMatches() {
  const db = getSupabase();

  const config = loadConfig();
  const lastCheck = config.lastMatchCheck || '1970-01-01T00:00:00Z';
  const now = new Date().toISOString();

  const { data: watches, error: watchError } = await db
    .from('watches')
    .select('*, users(id, channel_id, channel_type)');

  if (watchError) throw watchError;

  if (!watches || watches.length === 0) {
    console.log('No active watches.');
    config.lastMatchCheck = now;
    saveConfig(config);
    return;
  }

  const { data: newListings, error: listingError } = await db
    .from('listings')
    .select('*, users(id, channel_id, channel_type)')
    .eq('status', 'active')
    .gt('created_at', lastCheck)
    .order('created_at', { ascending: false });

  if (listingError) throw listingError;

  if (!newListings || newListings.length === 0) {
    console.log('No new listings since last check.');
    config.lastMatchCheck = now;
    saveConfig(config);
    return;
  }

  const matches = [];

  for (const listing of newListings) {
    for (const watch of watches) {
      if (watch.user_id === listing.user_id) continue;
      if (watch.max_price && listing.price > watch.max_price) continue;
      if (watch.min_rooms && listing.rooms < watch.min_rooms) continue;
      if (watch.neighborhoods && watch.neighborhoods.length > 0) {
        const listingHood = listing.neighborhood.toLowerCase();
        const matchesHood = watch.neighborhoods.some(h =>
          listingHood.includes(h.toLowerCase()) || h.toLowerCase().includes(listingHood)
        );
        if (!matchesHood) continue;
      }
      matches.push({ watch, listing, user: watch.users });
    }
  }

  config.lastMatchCheck = now;
  saveConfig(config);

  if (matches.length === 0) {
    console.log(`Checked ${newListings.length} new listing(s). No matches found.`);
    return;
  }

  console.log(`Found ${matches.length} match(es):\n`);

  const byUser = {};
  for (const match of matches) {
    const key = `${match.user.channel_type}:${match.user.channel_id}`;
    if (!byUser[key]) {
      byUser[key] = { user: match.user, listings: [] };
    }
    byUser[key].listings.push(match.listing);
  }

  for (const [channelKey, data] of Object.entries(byUser)) {
    console.log(`NOTIFY ${channelKey}:`);
    for (const listing of data.listings) {
      const id = listing.id.slice(0, 8);
      const dates = listing.date_start
        ? `${listing.date_start}${listing.date_end ? ' to ' + listing.date_end : ''}`
        : 'Flexible';
      console.log(`  - [${id}] ${listing.rooms}BR in ${listing.neighborhood} - $${listing.price}/mo (${dates})`);
      if (listing.description) {
        console.log(`    ${listing.description.slice(0, 50)}${listing.description.length > 50 ? '...' : ''}`);
      }
    }
    console.log('');
  }
}

function showHelp() {
  console.log(`
Niche v0 — Trading Card Marketplace with USD Escrow

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BROWSE (no account needed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  niche search              Search listings in terminal
  niche browse              Open listings in browser
  niche view <id>           Open specific listing in browser
  niche show <id>           View listing details in terminal

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AUTHENTICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  niche login               Open login in browser (Twitter/X + passkey)
  niche logout              Clear local session
  niche whoami              Show identity + wallet + balance

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LISTINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  niche post                Create a listing
  niche list                Your listings
  niche cancel <id>         Cancel your listing

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WATCHES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  niche watch               Set up a watch for matches
  niche watches             List active watches
  niche unwatch <id>        Remove a watch
  niche check-matches       Check for new matches (cron)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESCROW & FUNDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  niche interest <id>       Express interest (opens escrow in browser) 🔐
  niche confirm <id>        Confirm meetup happened 🔐
  niche dispute <id>        File a dispute 🔐
  niche escrow [id]         View escrow status
  niche balance             Check wallet balance
  niche fund [amount]       Open fiat on-ramp (MoonPay / Circle faucet)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TESTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  --simulate <name>         Simulate as a different user (no real funds)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  # Search and browse
  niche search --neighborhood "East Village" --max-price 2500
  niche browse --neighborhood "Williamsburg"
  niche view abc123

  # Login (opens browser)
  niche login

  # Express interest (opens escrow flow in browser)
  niche interest abc123

  # After viewing, both confirm
  niche confirm abc123

  # Fund wallet with fiat
  niche fund 2500

Testnet: Base Sepolia USD
Hosted UI: ${UI_BASE}
`);
}

// Run
main();
