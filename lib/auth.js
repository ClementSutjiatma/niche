/**
 * Auth Module (v0 — thin client)
 *
 * Token storage only. All Privy SDK, wallet creation, signing,
 * and transaction logic has moved to Supabase Edge Functions.
 *
 * This module manages ~/.niche/auth.json for:
 *  - Persisting auth state (privyUserId, wallet, userId) between CLI invocations
 *  - Checking if the user is logged in
 *  - Providing wallet address and user ID for API calls
 *
 * Auth file format (Twitter/Privy):
 * {
 *   "privyUserId": "did:privy:...",
 *   "wallet": "0x...",
 *   "walletId": "wallet_...",
 *   "userId": "supabase-uuid",
 *   "twitterUsername": "someuser",
 *   "provider": "twitter"
 * }
 */

const fs = require('fs');
const path = require('path');

// Config paths
const CONFIG_DIR = path.join(process.env.HOME, '.niche');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');

// Auth state management
let authState = null;

function loadAuthState() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveAuthState(state) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
  authState = state;
}

function clearAuthState() {
  try {
    fs.unlinkSync(AUTH_FILE);
  } catch {}
  authState = null;
}

function getAuthState() {
  if (!authState) {
    authState = loadAuthState();
  }
  return authState;
}

function isAuthenticated() {
  const state = getAuthState();
  if (!state) return false;

  // Require wallet (flat string or nested object)
  const wallet = state.wallet?.address || state.wallet;
  if (!wallet) return false;

  // Legacy: if expiresAt was set and is expired, reject
  if (state.expiresAt && new Date(state.expiresAt) < new Date()) {
    return false;
  }

  return true;
}

/**
 * Centralized auth guard.
 * Simulated users bypass auth. Returns true if authenticated,
 * false otherwise (with message printed).
 */
function requireAuth(user) {
  if (user && user.simulated) return true;

  if (!user) {
    console.log('Not set up yet. Run `niche login` first or use --simulate <name>.');
    return false;
  }

  if (!isAuthenticated()) {
    console.log('🔐 Authentication required.\n');
    console.log('Please login first:');
    console.log('  niche login');
    console.log('\nOr use --simulate <name> for testing without real funds.');
    return false;
  }

  return true;
}

function getWalletAddress() {
  const state = getAuthState();
  return state?.wallet?.address || state?.wallet || null;
}

function getWalletId() {
  const state = getAuthState();
  return state?.walletId || state?.wallet?.id || null;
}

function getUserId() {
  const state = getAuthState();
  return state?.userId || null;
}

function getUserIdentity() {
  const state = getAuthState();
  if (!state) return null;

  return {
    id: state.privyUserId,
    email: state.email,
    twitterUsername: state.twitterUsername,
    provider: state.provider || 'twitter',
    wallet: state.wallet?.address || state.wallet,
    walletId: state.walletId || state.wallet?.id,
    userId: state.userId,
  };
}

/**
 * Logout command handler
 */
function logout() {
  clearAuthState();
  console.log('✓ Logged out successfully.');
}

module.exports = {
  // Auth state
  loadAuthState,
  saveAuthState,
  clearAuthState,
  getAuthState,
  isAuthenticated,
  requireAuth,
  getWalletAddress,
  getWalletId,
  getUserId,
  getUserIdentity,

  // Login/logout
  logout,
};
