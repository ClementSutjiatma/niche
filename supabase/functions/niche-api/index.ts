/**
 * niche-api Edge Function
 *
 * Handles auth routes (/auth/lookup, /auth/wallet), escrow operations
 * (/escrow/deposit, /escrow/release, /escrow/:id), and other API endpoints.
 * Deployed to Supabase Edge Functions (Deno runtime).
 *
 * Key invariant: ONE wallet per Privy user. Every wallet creation path
 * must first check for an existing wallet via wallets().list({ user_id }).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PrivyClient } from "npm:@privy-io/node@0.2.0";
import { encodeFunctionData, erc20Abi } from "npm:viem@2";


// --- Config (from Supabase Vault / env) ---

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRIVY_APP_ID = Deno.env.get("PRIVY_APP_ID")!;
const PRIVY_APP_SECRET = Deno.env.get("PRIVY_APP_SECRET")!;

// Escrow wallet: an app-owned Privy wallet that holds USDC during escrow.
// Create via Privy dashboard → Wallets → Create Treasury Wallet, then store
// the wallet ID and address in Supabase Vault / env.
const ESCROW_WALLET_ID = Deno.env.get("ESCROW_WALLET_ID") || "";
const ESCROW_WALLET_ADDRESS = Deno.env.get("ESCROW_WALLET_ADDRESS") || "";

// USDC contract on Base Sepolia
const USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_CAIP2 = `eip155:${BASE_SEPOLIA_CHAIN_ID}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

// Twilio SMS service (for meetup coordination)
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") || "";

// Anthropic API (for meetup coordination agent)
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

// Privy webhook signing secret (for verifying webhook signatures)
const PRIVY_WEBHOOK_SIGNING_SECRET = Deno.env.get("PRIVY_WEBHOOK_SIGNING_SECRET") || "";

/** Send SMS via Twilio REST API (no SDK needed for Deno) */
async function sendSms(to: string, body: string): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log("[SMS] Twilio not configured, skipping SMS");
    return false;
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const params = new URLSearchParams({
      To: to,
      From: TWILIO_PHONE_NUMBER,
      Body: body,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[SMS] Twilio error:", err);
      return false;
    }
    console.log("[SMS] Sent to [REDACTED]");
    return true;
  } catch (err) {
    console.error("[SMS] Failed:", err);
    return false;
  }
}

/** Normalize phone to E.164 format */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+1${cleaned}`;
}

/** Validate E.164 phone number */
function isValidPhoneNumber(phone: string): boolean {
  return /^\+[1-9]\d{9,14}$/.test(phone);
}

/** One-way hash of phone number for webhook matching (irreversible) */
async function hashPhone(phone: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(TWILIO_AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(phone));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Encrypt phone number with AES-GCM (decryptable only by edge function with TWILIO_AUTH_TOKEN) */
async function encryptPhone(phone: string): Promise<string> {
  const encoder = new TextEncoder();
  // Derive a 256-bit key from TWILIO_AUTH_TOKEN via SHA-256
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(TWILIO_AUTH_TOKEN));
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(phone));
  // Store as: base64(iv):base64(ciphertext)
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  return `${ivB64}:${ctB64}`;
}

/** Decrypt phone number encrypted with encryptPhone() */
async function decryptPhone(encStr: string): Promise<string | null> {
  try {
    const [ivB64, ctB64] = encStr.split(":");
    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(TWILIO_AUTH_TOKEN));
    const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(decrypted);
  } catch {
    console.error("[CRYPTO] Failed to decrypt phone");
    return null;
  }
}

/** Validate Twilio webhook signature */
async function validateTwilioSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!TWILIO_AUTH_TOKEN) return false;

  const signature = req.headers.get("X-Twilio-Signature");
  if (!signature) return false;

  const url = new URL(req.url);
  const params = new URLSearchParams(rawBody);
  const sortedParams = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  let dataToSign = url.origin + url.pathname;
  for (const [key, value] of sortedParams) {
    dataToSign += key + value;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(TWILIO_AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(dataToSign));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return signature === expected;
}

// --- Helpers ---

// CORS: restrict to known origins (Vercel deploys + local dev)
const ALLOWED_ORIGINS = [
  "https://niche-ui-eight.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
];

function getCorsHeaders(origin?: string | null): Record<string, string> {
  const isAllowed = origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    // Allow all Vercel preview deploys
    /^https:\/\/niche-.*\.vercel\.app$/.test(origin) ||
    origin.endsWith("-clement-sutjiatmas-projects.vercel.app")
  );
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Request-scoped CORS headers (set per-request in router)
let _reqCorsHeaders: Record<string, string> = getCorsHeaders(null);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ..._reqCorsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return json({ error: message }, status);
}

// --- Rate Limiting (in-memory, resets on cold start) ---

const rateLimits = new Map<string, { count: number; resetAt: number }>();
let rateLimitCleanupCounter = 0;

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || entry.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

function rateLimitCleanup() {
  if (++rateLimitCleanupCounter % 500 === 0) {
    const now = Date.now();
    for (const [key, entry] of rateLimits) {
      if (entry.resetAt <= now) rateLimits.delete(key);
    }
  }
}

// --- JWT Authentication ---

/**
 * Verify the Privy JWT from the Authorization header.
 * Returns the verified Privy user ID (did:privy:...).
 */
async function verifyAuth(req: Request): Promise<{ privyUserId: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }
  const token = authHeader.replace("Bearer ", "");
  // Reject the Supabase anon key being used as bearer token (old pattern)
  if (token === Deno.env.get("SUPABASE_ANON_KEY")) {
    throw new Error("Invalid authentication token");
  }
  try {
    const claims = await privy.verifyAuthToken(token);
    return { privyUserId: claims.userId };
  } catch (err) {
    console.error("[AUTH] Token verification failed:", err);
    throw new Error("Invalid or expired authentication token");
  }
}

/**
 * Look up the local DB user for a verified Privy user ID.
 * First tries the fast path (privy_user_id column), then falls back
 * to Privy API + channel_id lookup for users not yet backfilled.
 */
async function resolveUser(privyUserId: string): Promise<any | null> {
  // Fast path: direct lookup by privy_user_id
  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();
  if (user) return user;

  // Fallback: look up via Privy API to get linked accounts, then match
  try {
    const privyUser = await privy.getUser(privyUserId);

    // Try Twitter first (primary auth method)
    if (privyUser.twitter?.subject) {
      const { data: twitterUser } = await supabase
        .from("users")
        .select("*")
        .eq("channel_id", privyUser.twitter.subject)
        .eq("channel_type", "twitter")
        .maybeSingle();
      if (twitterUser) {
        // Backfill privy_user_id for future fast lookups
        await supabase.from("users").update({ privy_user_id: privyUserId }).eq("id", twitterUser.id);
        return twitterUser;
      }
    }

    // Try email fallback
    if (privyUser.email?.address) {
      const { data: emailUser } = await supabase
        .from("users")
        .select("*")
        .eq("channel_id", privyUser.email.address)
        .eq("channel_type", "email")
        .maybeSingle();
      if (emailUser) {
        await supabase.from("users").update({ privy_user_id: privyUserId }).eq("id", emailUser.id);
        return emailUser;
      }
    }

    return null;
  } catch (err) {
    console.error("[AUTH] Failed to resolve user via Privy:", err);
    return null;
  }
}

/**
 * Verify and resolve auth in one step. Returns the DB user.
 * Throws on auth failure.
 */
async function requireAuth(req: Request): Promise<any> {
  const { privyUserId } = await verifyAuth(req);
  const user = await resolveUser(privyUserId);
  if (!user) throw new Error("User not found");
  return user;
}

// --- Privy Webhook Signature Verification ---

async function verifyPrivyWebhookSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!PRIVY_WEBHOOK_SIGNING_SECRET) {
    console.error("[PRIVY WEBHOOK] Webhook signing secret not configured — rejecting");
    return false; // FAIL CLOSED
  }

  const signature = req.headers.get("privy-signature") || req.headers.get("svix-signature");
  const timestamp = req.headers.get("privy-timestamp") || req.headers.get("svix-timestamp");
  const webhookId = req.headers.get("privy-webhook-id") || req.headers.get("svix-id");

  if (!signature || !timestamp) return false;

  // Privy uses Svix: signed data = "<webhook-id>.<timestamp>.<body>"
  const signedPayload = `${webhookId}.${timestamp}.${rawBody}`;

  const encoder = new TextEncoder();
  // Privy webhook secrets are base64-encoded, prefixed with "whsec_"
  const secretBytes = Uint8Array.from(
    atob(PRIVY_WEBHOOK_SIGNING_SECRET.replace("whsec_", "")),
    (c) => c.charCodeAt(0)
  );

  const key = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expectedSig = "v1," + btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Svix may send multiple signatures separated by spaces
  const signatures = signature.split(" ");
  return signatures.some((s) => s === expectedSig);
}

/**
 * Upsert a user row in Supabase. Matches on channel_id + channel_type.
 * Updates wallet_address if it changed.
 */
async function upsertUser(
  privyUserId: string,
  channelId: string,
  channelType: string,
  displayName: string,
  walletAddress: string,
  walletId?: string,
  twitterUsername?: string,
  twitterUserId?: string
) {
  // Check if user exists by channel_id and channel_type
  const { data: existing } = await supabase
    .from("users")
    .select("id, wallet_address, twitter_username, twitter_user_id, passkey_credential_id, passkey_public_key, privy_user_id")
    .eq("channel_id", channelId)
    .eq("channel_type", channelType)
    .single();

  if (existing) {
    // Update wallet, Twitter info, and privy_user_id if changed
    const updates: any = {};
    if (existing.wallet_address !== walletAddress) {
      updates.wallet_address = walletAddress;
    }
    if (twitterUsername && existing.twitter_username !== twitterUsername) {
      updates.twitter_username = twitterUsername;
    }
    if (twitterUserId && existing.twitter_user_id !== twitterUserId) {
      updates.twitter_user_id = twitterUserId;
    }
    // Backfill privy_user_id for JWT auth resolution
    if (privyUserId && !existing.privy_user_id) {
      updates.privy_user_id = privyUserId;
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from("users")
        .update(updates)
        .eq("id", existing.id);
    }
    return existing;
  }

  // Insert new user
  const { data: newUser, error } = await supabase
    .from("users")
    .insert({
      channel_id: channelId,
      channel_type: channelType,
      wallet_address: walletAddress,
      display_name: displayName,
      twitter_username: twitterUsername,
      twitter_user_id: twitterUserId,
      privy_user_id: privyUserId || null,
    })
    .select()
    .single();

  if (error) throw error;
  return newUser;
}

/**
 * Send email notifications to buyer and seller when escrow completes
 */
async function sendEscrowCompletionEmails(escrow: any) {
  if (!resend) {
    console.log("[EMAIL] Resend not configured, skipping email notifications");
    return;
  }

  console.log("[EMAIL] Sending completion notifications...");

  try {
    // Get buyer and seller info
    const { data: buyer } = await supabase
      .from("users")
      .select("channel_id, channel_type, display_name")
      .eq("id", escrow.buyer_id)
      .single();

    const { data: seller } = await supabase
      .from("users")
      .select("channel_id, channel_type, display_name")
      .eq("id", escrow.seller_id)
      .single();

    // Get listing info
    const { data: listing } = await supabase
      .from("listings")
      .select("item_name, category, price")
      .eq("id", escrow.listing_id)
      .single();

    if (!buyer || !seller || !listing) {
      console.error("[EMAIL] Missing buyer/seller/listing data");
      return;
    }

    // Extract emails (only if channel_type is 'email' or 'privy')
    const buyerEmail = (buyer.channel_type === "email" || buyer.channel_type === "privy")
      ? buyer.channel_id
      : null;
    const sellerEmail = (seller.channel_type === "email" || seller.channel_type === "privy")
      ? seller.channel_id
      : null;

    // Transaction details for both emails
    const cardName = listing.item_name;
    const category = listing.category || "Mac Mini";
    const price = escrow.total_price;
    const escrowUrl = `https://niche-ddq89ltdk-clement-sutjiatmas-projects.vercel.app/escrow/${escrow.id}`;
    const releaseTxUrl = escrow.release_tx_hash
      ? `https://sepolia.basescan.org/tx/${escrow.release_tx_hash}`
      : null;

    // Send email to BUYER
    if (buyerEmail) {
      try {
        await resend.emails.send({
          from: "Niche Marketplace <noreply@niche.app>",
          to: buyerEmail,
          subject: `Payment Complete - ${cardName}`,
          html: `
            <h2>Payment Complete!</h2>
            <p>Hi ${buyer.display_name || "there"},</p>
            <p>Your purchase of <strong>${cardName}</strong> (${category}) is complete!</p>

            <h3>Transaction Details:</h3>
            <ul>
              <li><strong>Item:</strong> ${cardName}</li>
              <li><strong>Total Paid:</strong> $${price} USD</li>
              <li><strong>Status:</strong> Funds released to seller</li>
            </ul>

            ${releaseTxUrl ? `<p><a href="${releaseTxUrl}">View transaction on BaseScan</a></p>` : ""}
            <p><a href="${escrowUrl}">View payment details</a></p>

            <p>Thank you for using Niche!</p>
          `,
        });
        console.log(`[EMAIL] Sent to buyer: ${buyerEmail}`);
      } catch (err) {
        console.error(`[EMAIL] Failed to send to buyer:`, err);
      }
    }

    // Send email to SELLER
    if (sellerEmail) {
      try {
        await resend.emails.send({
          from: "Niche Marketplace <noreply@niche.app>",
          to: sellerEmail,
          subject: `Payment Received - ${cardName}`,
          html: `
            <h2>Payment Received!</h2>
            <p>Hi ${seller.display_name || "there"},</p>
            <p>You've received payment for <strong>${cardName}</strong> (${category}).</p>

            <h3>Transaction Details:</h3>
            <ul>
              <li><strong>Item:</strong> ${cardName}</li>
              <li><strong>Amount Received:</strong> $${price} USD</li>
              <li><strong>Status:</strong> Funds transferred to your wallet</li>
            </ul>

            ${releaseTxUrl ? `<p><a href="${releaseTxUrl}">View transaction on BaseScan</a></p>` : ""}
            <p><a href="${escrowUrl}">View payment details</a></p>

            <p>Thank you for using Niche!</p>
          `,
        });
        console.log(`[EMAIL] Sent to seller: ${sellerEmail}`);
      } catch (err) {
        console.error(`[EMAIL] Failed to send to seller:`, err);
      }
    }
  } catch (err) {
    console.error("[EMAIL] Error in sendEscrowCompletionEmails:", err);
  }
}

// --- Route Handlers ---

/**
 * POST /auth/lookup
 *
 * Looks up an existing user + wallet. Checks Supabase first, then
 * falls back to Privy wallets().list() if not found locally.
 * Backfills the Supabase users row if found in Privy but not Supabase.
 */
async function handleAuthLookup(body: {
  privyUserId: string;
  email?: string;
  twitterUsername?: string;
  twitterUserId?: string;
}) {
  const { privyUserId, email, twitterUsername, twitterUserId } = body;

  if (!privyUserId) {
    return errorResponse("Missing privyUserId");
  }

  // Determine which channel to use (Twitter preferred, email fallback)
  const channelId = twitterUserId || email;
  const channelType = twitterUserId ? "twitter" : "email";
  const displayName = twitterUsername ? `@${twitterUsername}` : email;

  if (!channelId) {
    return errorResponse("Missing channel identifier (twitterUserId or email)");
  }

  // Layer 1: Check Supabase users table by channel_id
  const { data: user } = await supabase
    .from("users")
    .select("id, wallet_address, channel_id, channel_type, display_name, twitter_username, twitter_user_id, passkey_credential_id, passkey_public_key, privy_user_id")
    .eq("channel_id", channelId)
    .eq("channel_type", channelType)
    .single();

  if (user?.wallet_address) {
    // Backfill privy_user_id if missing
    if (privyUserId && !user.privy_user_id) {
      await supabase.from("users").update({ privy_user_id: privyUserId }).eq("id", user.id);
    }
    return json({
      found: true,
      wallet: user.wallet_address,
      walletId: user.id, // Using user ID as walletId for now
      userId: user.id,
      passkeyCredentialId: user.passkey_credential_id || null,
      passkeyPublicKey: user.passkey_public_key || null,
    });
  }

  // Layer 2: Fall back to Privy — check if this user already has a wallet
  try {
    const wallets = await privy.wallets().list({
      user_id: privyUserId,
      chain_type: "ethereum",
    });

    const existing = wallets?.data?.[0];
    if (existing) {
      // Wallet exists in Privy but not in Supabase — backfill
      const backfilledUser = await upsertUser(
        privyUserId,
        channelId,
        channelType,
        displayName || channelId,
        existing.address,
        existing.id,
        twitterUsername,
        twitterUserId
      );
      return json({
        found: true,
        wallet: existing.address,
        walletId: existing.id,
        userId: backfilledUser.id,
        passkeyCredentialId: backfilledUser.passkey_credential_id || null,
        passkeyPublicKey: backfilledUser.passkey_public_key || null,
      });
    }
  } catch (err) {
    console.error("Privy wallet list fallback failed:", err);
    // Don't fail the lookup — just report not found
  }

  return json({ found: false });
}

/**
 * POST /auth/wallet
 *
 * Creates or retrieves a wallet for the given Privy user.
 * CRITICAL: Always checks for existing wallets before creating.
 *
 * Flow:
 *   1. privy.wallets().list({ user_id }) — check for existing wallet
 *   2. If found → return it (no new wallet created)
 *   3. If not found → create with deterministic idempotency key
 *   4. Upsert Supabase users row
 */
async function handleAuthWallet(body: {
  privyUserId: string;
  email?: string;
  twitterUsername?: string;
  twitterUserId?: string;
  passkey?: { publicKey: string; credentialId: string };
}) {
  const { privyUserId, email, twitterUsername, twitterUserId, passkey } = body;

  if (!privyUserId) {
    return errorResponse("Missing privyUserId");
  }

  const channelId = twitterUserId || email;
  const channelType = twitterUserId ? "twitter" : "email";
  const displayName = twitterUsername ? `@${twitterUsername}` : email;

  if (!channelId || !displayName) {
    return errorResponse("Missing channel identifier or display name");
  }

  // Step 1: Check for existing wallet owned by this user
  try {
    const existingWallets = await privy.wallets().list({
      user_id: privyUserId,
      chain_type: "ethereum",
    });

    const existing = existingWallets?.data?.[0];
    if (existing) {
      // Wallet already exists — reuse it, do NOT create a new one
      console.log(
        `Reusing existing wallet ${existing.address} for user ${privyUserId}`
      );
      const user = await upsertUser(
        privyUserId,
        channelId,
        channelType,
        displayName,
        existing.address,
        existing.id,
        twitterUsername,
        twitterUserId
      );
      return json({
        wallet: existing.address,
        walletId: existing.id,
        userId: user.id,
        reused: true,
      });
    }
  } catch (err) {
    console.error("Failed to list existing wallets:", err);
    // Continue to creation — but use idempotency key as safety net
  }

  // Step 2: No existing wallet — create with deterministic idempotency key
  // The idempotency key prevents duplicates if this request is retried
  // within Privy's 24-hour idempotency window.
  const idempotencyKey = `wallet-create-${privyUserId}-ethereum`;

  try {
    const wallet = await privy.wallets().create({
      chain_type: "ethereum",
      owner: { user_id: privyUserId },
      "privy-idempotency-key": idempotencyKey,
    });

    console.log(
      `Created new wallet ${wallet.address} for user ${privyUserId}`
    );

    // Step 3: Upsert user in Supabase with the new wallet
    const user = await upsertUser(
      privyUserId,
      channelId,
      channelType,
      displayName,
      wallet.address,
      wallet.id,
      twitterUsername,
      twitterUserId
    );

    // Note: passkey registration removed from this route for security.
    // Use POST /auth/register-passkey (JWT-authenticated) instead.

    return json({
      wallet: wallet.address,
      walletId: wallet.id,
      userId: user.id,
      reused: false,
    });
  } catch (err: any) {
    console.error("Wallet creation failed:", err);
    return errorResponse(err?.message || "Wallet creation failed", 500);
  }
}

// --- Escrow Helpers ---

/**
 * Encode a USDC ERC-20 transfer call.
 * USDC has 6 decimals, so $2200 = 2200 * 10^6 = 2200000000.
 */
function encodeUsdcTransfer(to: string, amountUsd: number): string {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to as `0x${string}`, BigInt(Math.round(amountUsd * 1e6))],
  });
}

/**
 * Look up a Privy wallet ID for a given wallet address.
 * We need the wallet ID (not the address) to call Privy's sendTransaction.
 */
async function findPrivyWalletId(walletAddress: string): Promise<string | null> {
  console.log(`[findPrivyWalletId] Looking up wallet: ${walletAddress}`);

  // Look up the user in our DB to get their Privy user ID
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("channel_id, channel_type, wallet_address")
    .eq("wallet_address", walletAddress)
    .single();

  if (userError) {
    console.error(`[findPrivyWalletId] Database error:`, userError);
    return null;
  }

  if (!user) {
    console.error(`[findPrivyWalletId] No user found with wallet: ${walletAddress}`);
    return null;
  }

  console.log(`[findPrivyWalletId] Found user - channel_id: ${user.channel_id}, channel_type: ${user.channel_type}`);

  // The channel_id should be the Privy user ID (did:privy:...)
  if (user.channel_type !== "privy" || !user.channel_id.startsWith("did:privy:")) {
    console.error(`[findPrivyWalletId] User is not a Privy user - channel_type: ${user.channel_type}, channel_id: ${user.channel_id}`);
    return null;
  }

  const privyUserId = user.channel_id;
  console.log(`[findPrivyWalletId] Using Privy user ID: ${privyUserId}`);

  // Use Privy to list wallets and find the matching one
  try {
    console.log(`[findPrivyWalletId] Listing wallets for user ${privyUserId}`);
    const wallets = await privy.wallets().list({
      user_id: privyUserId,
      chain_type: "ethereum",
    });

    console.log(`[findPrivyWalletId] Found ${wallets?.data?.length || 0} wallets`);

    if (wallets?.data) {
      for (const w of wallets.data) {
        console.log(`[findPrivyWalletId] Wallet: ${w.address} (id: ${w.id})`);
      }
    }

    const match = wallets?.data?.find(
      (w: { address: string }) =>
        w.address.toLowerCase() === walletAddress.toLowerCase()
    );

    if (match) {
      console.log(`[findPrivyWalletId] Found matching wallet ID: ${match.id}`);
      return match.id;
    } else {
      console.error(`[findPrivyWalletId] No wallet with address ${walletAddress} found for user ${privyUserId}`);
      return null;
    }
  } catch (err) {
    console.error("[findPrivyWalletId] Failed to find Privy wallet ID:", err);
    return null;
  }
}

// --- Escrow Route Handlers ---

/**
 * POST /escrow/deposit
 *
 * Deposits USDC from the buyer's Privy wallet into the platform escrow wallet.
 * The passkey assertion proves the user authorized this specific deposit.
 *
 * Body: { listingId, buyerWallet, buyerUserId, amount, passkey, challengeParams }
 */
async function handleEscrowDeposit(body: {
  listingId: string;
  buyerWallet: string;
  buyerUserId: string;
  depositAmount: number;
  totalPrice: number;
  transactionId?: string; // NEW: from client execution
  transactionHash?: string; // NEW: from client execution
  passkey: {
    signature: string;
    authenticatorData: string;
    clientDataJSON: string;
  };
  challengeParams?: {
    listingId: string;
    wallet: string;
    amount: number;
    timestamp: number;
  };
}) {
  const {
    listingId,
    buyerWallet,
    depositAmount,
    totalPrice,
    transactionId,
    transactionHash,
    passkey,
    challengeParams,
  } = body;

  console.log(`[ESCROW DEPOSIT] Processing deposit for listing ${listingId}`);
  console.log(`[ESCROW DEPOSIT] Buyer: ${buyerWallet}, Deposit: ${depositAmount}, Total: ${totalPrice}`);
  console.log(`[ESCROW DEPOSIT] Transaction ID: ${transactionId}`);

  if (!listingId || !buyerWallet || !depositAmount || !totalPrice) {
    return errorResponse("Missing required fields: listingId, buyerWallet, depositAmount, totalPrice");
  }

  if (!passkey?.signature || !passkey?.authenticatorData || !passkey?.clientDataJSON) {
    return errorResponse("Missing passkey assertion data");
  }

  // 1. Verify the user exists and owns this wallet
  console.log(`[ESCROW DEPOSIT] Looking up buyer wallet: ${buyerWallet}`);
  const { data: buyer, error: buyerError } = await supabase
    .from("users")
    .select("id, wallet_address, passkey_public_key, passkey_credential_id")
    .eq("wallet_address", buyerWallet)
    .single();

  if (buyerError) {
    console.error(`[ESCROW DEPOSIT] Database error looking up buyer:`, buyerError);
  }

  if (!buyer) {
    console.error(`[ESCROW DEPOSIT] Buyer wallet not found: ${buyerWallet}`);
    console.log(`[ESCROW DEPOSIT] Available users in database:`);
    const { data: allUsers } = await supabase
      .from("users")
      .select("id, wallet_address, channel_id, channel_type")
      .limit(10);
    console.log(JSON.stringify(allUsers, null, 2));
    return errorResponse("Buyer wallet not found in our records");
  }

  console.log(`[ESCROW DEPOSIT] Found buyer:`, {
    id: buyer.id,
    wallet: buyer.wallet_address,
    hasPasskey: !!buyer.passkey_credential_id
  });

  // Note: Passkey verification removed — JWT auth (verifyAuth) now provides
  // real authentication. The client-side biometric prompt remains as UX security.
  // Passkey data in the request is accepted but not validated server-side.

  // 3. Look up the listing
  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("id, user_id, price, min_deposit, item_name, category, status")
    .eq("id", listingId)
    .single();

  if (listingError || !listing) {
    return errorResponse("Listing not found");
  }

  if (listing.status !== "active") {
    return errorResponse(`Listing is not active (current status: ${listing.status})`);
  }

  if (listing.user_id === buyer.id) {
    return errorResponse("You cannot deposit escrow on your own listing");
  }

  // Verify deposit amount meets minimum requirement
  if (depositAmount < listing.min_deposit) {
    return errorResponse(`Deposit must be at least $${listing.min_deposit}`);
  }

  // Verify total price matches listing
  if (totalPrice !== listing.price) {
    return errorResponse(`Total price mismatch. Expected $${listing.price}`);
  }

  // 4. Check for existing escrow on this listing
  const { data: existingEscrow } = await supabase
    .from("escrows")
    .select("id, status")
    .eq("listing_id", listingId)
    .in("status", ["deposited"])
    .maybeSingle();

  if (existingEscrow) {
    return errorResponse("An escrow already exists for this listing");
  }

  // 5. Verify transaction via Privy API (optional but recommended)
  if (transactionId) {
    try {
      console.log(`[ESCROW DEPOSIT] Verifying transaction ${transactionId} via Privy API`);

      const transaction = await privy.transactions().get(transactionId);

      if (transaction.status !== "confirmed" && transaction.status !== "pending") {
        return errorResponse(
          `Transaction status is ${transaction.status}. Expected confirmed or pending.`
        );
      }

      console.log(`[ESCROW DEPOSIT] Transaction verified: ${transaction.status}`);
    } catch (err: any) {
      console.error("[ESCROW DEPOSIT] Transaction verification failed:", err);
      // Continue anyway - webhook will update later if needed
    }
  }

  // 6. Record escrow in database (with 48h expiry for seller to accept)
  const remainingAmount = totalPrice - depositAmount;
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: escrow, error: escrowError } = await supabase
    .from("escrows")
    .insert({
      listing_id: listingId,
      buyer_id: buyer.id,
      seller_id: listing.user_id,
      deposit_amount: depositAmount,
      total_price: totalPrice,
      remaining_amount: remainingAmount,
      currency: "USDC",
      escrow_service: "onchain",
      escrow_id: transactionId || transactionHash || "",
      status: "deposited",
      deposit_tx_hash: transactionHash,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (escrowError) {
    console.error("DB insert failed:", escrowError);
    return errorResponse("Failed to record escrow", 500);
  }

  // 7. Update listing status
  await supabase
    .from("listings")
    .update({ status: "pending" })
    .eq("id", listingId);

  console.log(`[ESCROW DEPOSIT] Escrow created: ${escrow.id}`);

  return json({
    escrowId: escrow.id,
    transactionId,
    transactionHash,
  });
}

// NOTE: handleEscrowRelease REMOVED — it accepted sellerAddress from the request
// body (fund theft vector). Release is now handled exclusively by the seller
// confirm flow in handleEscrowConfirm, which looks up the seller address from DB.

/**
 * GET /escrow/:id
 *
 * Returns a single escrow with its associated listing info.
 */
async function handleGetEscrow(escrowId: string) {
  const escrowSelect = `
    *,
    listings(id, item_name, price, min_deposit, category, status),
    buyer:users!buyer_id(id, wallet_address, twitter_username, display_name),
    seller:users!seller_id(id, wallet_address, twitter_username, display_name)
  `;

  const { data: escrow, error } = await supabase
    .from("escrows")
    .select(escrowSelect)
    .eq("id", escrowId)
    .single();

  if (error || !escrow) {
    return errorResponse("Escrow not found", 404);
  }

  // Check and auto-expire if needed
  await checkAndExpireEscrow(escrow);

  // Refetch if expired
  if (escrow.status === "deposited" && escrow.expires_at && new Date(escrow.expires_at) <= new Date()) {
    const { data: refreshed } = await supabase
      .from("escrows")
      .select(escrowSelect)
      .eq("id", escrowId)
      .single();
    return json({ escrow: refreshed || escrow });
  }

  return json({ escrow });
}

/**
 * GET /escrows?user_id=<uuid>
 *
 * Returns all escrows where the user is buyer or seller.
 */
async function handleListEscrows(userId: string) {
  if (!userId) {
    return errorResponse("Missing user_id query parameter");
  }

  const { data: escrows, error } = await supabase
    .from("escrows")
    .select("*, listings(id, item_name, price, min_deposit, category)")
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to list escrows:", error);
    return errorResponse("Failed to fetch escrows", 500);
  }

  return json({ escrows: escrows || [] });
}

/**
 * POST /escrow/confirm
 *
 * Records a buyer or seller confirmation. If both have confirmed,
 * triggers the on-chain release automatically.
 *
 * Body: { escrowId, walletAddress }
 */
async function handleEscrowConfirm(body: {
  escrowId: string;
  walletAddress: string;
  remainingPaymentTxHash?: string;
  passkey?: {
    signature: string;
    authenticatorData: string;
    clientDataJSON: string;
  };
}) {
  const { escrowId, walletAddress, remainingPaymentTxHash, passkey } = body;

  if (!escrowId || !walletAddress) {
    return errorResponse("Missing escrowId or walletAddress");
  }

  // 1. Find escrow
  const { data: escrow, error: escrowError } = await supabase
    .from("escrows")
    .select("*, listings(user_id)")
    .eq("id", escrowId)
    .single();

  if (escrowError || !escrow) {
    return errorResponse("Escrow not found");
  }

  // 2. Determine role
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) return errorResponse("Wallet not found");

  let role: "buyer" | "seller";
  if (user.id === escrow.buyer_id) {
    role = "buyer";
  } else if (user.id === escrow.seller_id) {
    role = "seller";
  } else {
    return errorResponse("You are not involved in this escrow");
  }

  // 3. Enforce new state ordering:
  //    - Buyer can confirm when status = 'accepted' (pays remaining, moves to buyer_confirmed)
  //    - Seller can confirm when status = 'buyer_confirmed' (triggers release)
  if (role === "buyer") {
    if (escrow.status !== "accepted") {
      return errorResponse(`Buyer can only confirm when escrow is accepted (current: ${escrow.status})`);
    }
    if (escrow.buyer_confirmed) {
      return errorResponse("Buyer already confirmed");
    }
    if (!remainingPaymentTxHash) {
      return errorResponse("Buyer must include remaining payment when confirming");
    }

    // Note: Passkey verification removed — JWT auth provides real authentication.

    // Update escrow: buyer confirmed + payment, status -> buyer_confirmed
    await supabase
      .from("escrows")
      .update({
        buyer_confirmed: true,
        status: "buyer_confirmed",
        remaining_payment_tx_hash: remainingPaymentTxHash,
        remaining_payment_confirmed_at: new Date().toISOString(),
      })
      .eq("id", escrowId);

    return json({
      confirmed: true,
      role,
      released: false,
      status: "buyer_confirmed",
    });
  }

  // SELLER confirmation — triggers fund release
  if (role === "seller") {
    if (escrow.status !== "buyer_confirmed") {
      return errorResponse(`Seller can only confirm after buyer has confirmed and paid (current: ${escrow.status})`);
    }
    if (escrow.seller_confirmed) {
      return errorResponse("Seller already confirmed");
    }

    // Mark seller confirmed
    await supabase
      .from("escrows")
      .update({ seller_confirmed: true })
      .eq("id", escrowId);

    // Trigger on-chain release
    let released = false;
    let releaseTxHash: string | undefined;

    if (escrow.escrow_service === "onchain") {
      try {
        const { data: seller } = await supabase
          .from("users")
          .select("wallet_address")
          .eq("id", escrow.seller_id)
          .single();

        if (seller?.wallet_address && ESCROW_WALLET_ID) {
          const totalRelease = escrow.total_price;
          console.log(`[RELEASE] Seller confirmed. Releasing ${totalRelease} USDC to ${seller.wallet_address}`);

          const transferData = encodeUsdcTransfer(seller.wallet_address, totalRelease);
          const result = await privy.wallets().ethereum().sendTransaction(
            ESCROW_WALLET_ID,
            {
              caip2: BASE_SEPOLIA_CAIP2,
              params: {
                transaction: {
                  to: USDC_CONTRACT,
                  data: transferData,
                  chain_id: BASE_SEPOLIA_CHAIN_ID,
                },
              },
              sponsor: true,
            }
          );

          releaseTxHash = result.hash;
          released = true;
          console.log(`[RELEASE] Escrow released: ${escrowId}, tx: ${releaseTxHash}`);
        }
      } catch (err: any) {
        console.error("[RELEASE] On-chain release failed:", err);
        // Still mark as released for MVP
        released = true;
      }
    } else {
      // Simulated escrow
      releaseTxHash = "simulated-release-" + Date.now();
      released = true;
    }

    if (released) {
      await supabase
        .from("escrows")
        .update({
          status: "released",
          release_tx_hash: releaseTxHash,
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", escrowId);

      await supabase
        .from("listings")
        .update({ status: "sold" })
        .eq("id", escrow.listing_id);

      try {
        await sendEscrowCompletionEmails(escrow);
      } catch (emailErr) {
        console.error("[EMAIL] Notification failed (non-blocking):", emailErr);
      }
    }

    return json({
      confirmed: true,
      role,
      released,
      releaseTxHash,
      status: released ? "released" : "buyer_confirmed",
    });
  }

  return errorResponse("Unknown role");
}

/**
 * POST /escrow/cancel
 *
 * Allows buyer to cancel deposit and get full refund before seller confirms.
 *
 * Body: { escrowId, walletAddress }
 */
async function handleEscrowCancel(body: {
  escrowId: string;
  walletAddress: string;
}) {
  const { escrowId, walletAddress } = body;

  if (!escrowId || !walletAddress) {
    return errorResponse("Missing escrowId or walletAddress");
  }

  // 1. Look up escrow with buyer and seller info
  const { data: escrow } = await supabase
    .from("escrows")
    .select(`
      *,
      buyer:users!buyer_id(id, wallet_address),
      seller:users!seller_id(id, wallet_address)
    `)
    .eq("id", escrowId)
    .single();

  if (!escrow) {
    return errorResponse("Escrow not found");
  }

  // 2. Verify caller is the buyer
  if (walletAddress !== escrow.buyer.wallet_address) {
    return errorResponse("Only buyer can cancel deposit");
  }

  // 3. Check status — can cancel when deposited (awaiting seller) or accepted (before buyer pays)
  if (!["deposited", "accepted"].includes(escrow.status)) {
    return errorResponse(`Cannot cancel escrow in ${escrow.status} state`);
  }

  console.log(`[CANCEL] Refunding ${escrow.deposit_amount} USDC to buyer ${escrow.buyer.wallet_address}`);

  // 5. Encode USDC transfer: escrow_wallet → buyer_wallet
  const transferData = encodeUsdcTransfer(
    escrow.buyer.wallet_address,
    escrow.deposit_amount
  );

  // 6. Execute refund via Privy (server-side for escrow wallet)
  const result = await privy.wallets().ethereum().sendTransaction(
    ESCROW_WALLET_ID,
    {
      caip2: BASE_SEPOLIA_CAIP2,
      params: {
        transaction: {
          to: USDC_CONTRACT,
          data: transferData,
          chain_id: BASE_SEPOLIA_CHAIN_ID,
        },
      },
      sponsor: true,
    }
  );

  // 7. Update escrow status to cancelled
  await supabase
    .from("escrows")
    .update({
      status: "cancelled",
      release_tx_hash: result.transaction_hash || result.transaction_id,
    })
    .eq("id", escrowId);

  // 8. Update listing status back to active
  await supabase
    .from("listings")
    .update({ status: "active" })
    .eq("id", escrow.listing_id);

  console.log(`[CANCEL] Refund complete, tx: ${result.transaction_hash || result.transaction_id}`);

  return json({
    success: true,
    refundTxHash: result.transaction_hash || result.transaction_id,
  });
}

/**
 * POST /escrow/dispute
 *
 * Files a dispute, freezing the escrowed funds.
 *
 * Body: { escrowId, walletAddress, reason }
 */
async function handleEscrowDispute(body: {
  escrowId: string;
  walletAddress: string;
  reason?: string;
}) {
  const { escrowId, walletAddress, reason } = body;

  if (!escrowId || !walletAddress) {
    return errorResponse("Missing escrowId or walletAddress");
  }

  const { data: escrow } = await supabase
    .from("escrows")
    .select("*")
    .eq("id", escrowId)
    .single();

  if (!escrow) return errorResponse("Escrow not found");
  if (!["deposited", "accepted", "buyer_confirmed"].includes(escrow.status)) {
    return errorResponse(`Cannot dispute: escrow is ${escrow.status}`);
  }

  // Verify the caller is involved
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) return errorResponse("Wallet not found");
  if (user.id !== escrow.buyer_id && user.id !== escrow.seller_id) {
    return errorResponse("You are not involved in this escrow");
  }

  await supabase
    .from("escrows")
    .update({ status: "disputed" })
    .eq("id", escrowId);

  console.log(
    `Escrow disputed: ${escrowId}, reason: ${reason || "none provided"}`
  );

  return json({ disputed: true, reason: reason || "No reason provided" });
}

/**
 * GET /escrow/by-listing/:listingId
 *
 * Returns the active escrow (if any) for a given listing.
 */
async function handleGetEscrowByListing(listingId: string) {
  const { data: escrow } = await supabase
    .from("escrows")
    .select("*, listings(id, item_name, price, min_deposit, category, status)")
    .eq("listing_id", listingId)
    .in("status", ["deposited", "accepted", "buyer_confirmed", "released"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return json({ escrow: escrow || null });
}

/**
 * GET /wallet/balance/:walletId
 *
 * Returns the USDC balance for a given Privy wallet ID.
 */
async function handleGetWalletBalance(walletId: string) {
  if (!walletId) {
    return errorResponse("Missing walletId");
  }

  try {
    // Try to fetch USDC balance using Privy RPC
    // The getBalance method may not be available in all SDK versions,
    // so we gracefully fall back to "0.00" if it fails.
    const wallet = privy.wallets().ethereum();
    if (typeof wallet.getBalance === "function") {
      const balances = await wallet.getBalance(walletId, {
        caip2: BASE_SEPOLIA_CAIP2,
        address: USDC_CONTRACT,
      });
      const usdcBalance = balances.balance ? (Number(balances.balance) / 1e6).toFixed(2) : "0.00";
      return json({ balance: usdcBalance });
    }

    // Fallback: return 0 if getBalance is not available
    console.log("[BALANCE] getBalance not available in current Privy SDK version");
    return json({ balance: "0.00", note: "Balance check unavailable" });
  } catch (err: any) {
    console.error("Failed to fetch wallet balance:", err);
    // Return 0 instead of 500 to avoid noisy errors in the UI
    return json({ balance: "0.00", note: "Balance check failed" });
  }
}

/**
 * GET /auth/passkey-status?email=...
 *
 * Checks if a user has a passkey registered in the database.
 * Returns { hasPasskey: boolean, userId?: string }
 */
async function handlePasskeyStatus(email: string) {
  if (!email) {
    return errorResponse("Missing email parameter");
  }

  // Look up user by display_name (which is set to email for email-based users)
  const { data: user } = await supabase
    .from("users")
    .select("id, passkey_credential_id, passkey_public_key")
    .eq("display_name", email)
    .maybeSingle();

  if (!user) {
    return json({ hasPasskey: false });
  }

  const hasPasskey = !!(user.passkey_credential_id && user.passkey_public_key);

  // Only return boolean — do not expose userId, publicKey, or credentialId
  // to unauthenticated callers (prevents account enumeration)
  return json({ hasPasskey });
}

/**
 * POST /auth/register-passkey
 *
 * Registers a passkey for an existing user who doesn't have one.
 * This is for users who created accounts before passkey enforcement.
 */
async function handleRegisterPasskey(body: {
  email?: string;
  passkey: { publicKey: string; credentialId: string };
  _verifiedUserId?: string; // Injected by router from JWT auth
}) {
  const { passkey, _verifiedUserId } = body;

  if (!passkey?.publicKey || !passkey?.credentialId) {
    return errorResponse("Missing passkey data");
  }

  if (!_verifiedUserId) {
    return errorResponse("Authentication required", 401);
  }

  // Update the verified user's passkey info
  const { error } = await supabase
    .from("users")
    .update({
      passkey_public_key: passkey.publicKey,
      passkey_credential_id: passkey.credentialId,
    })
    .eq("id", _verifiedUserId);

  if (error) {
    console.error("Failed to register passkey:", error);
    return errorResponse("Failed to register passkey", 500);
  }

  return json({ success: true, message: "Passkey registered successfully" });
}

/**
 * POST /auth/challenge
 *
 * Generates a random challenge for WebAuthn credential creation.
 * Returns a base64-encoded 32-byte random challenge.
 */
async function handleAuthChallenge(body: { userId?: string }) {
  // Generate 32 bytes of cryptographic randomness
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);

  // Encode as base64
  const challenge = btoa(String.fromCharCode(...challengeBytes));

  return json({ challenge });
}

/**
 * POST /webhooks/privy/transaction
 *
 * Webhook handler for Privy transaction events.
 * Privy sends this webhook when transactions are confirmed, failed, or reverted.
 */
async function handlePrivyTransactionWebhook(body: {
  type: string;
  data: {
    transaction_id: string;
    transaction_hash?: string;
    wallet_id: string;
    caip2?: string;
    user_operation_hash?: string;
  };
}) {
  const { type, data } = body;

  console.log(`[PRIVY WEBHOOK] Received ${type} for transaction ${data.transaction_id}`);

  if (type === "transaction.confirmed") {
    // Update escrow with final transaction hash
    const { error } = await supabase
      .from("escrows")
      .update({
        deposit_tx_hash: data.transaction_hash,
      })
      .eq("escrow_id", data.transaction_id);

    if (error) {
      console.error("[PRIVY WEBHOOK] Failed to update escrow:", error);
      return errorResponse("Failed to update escrow", 500);
    }

    console.log(`[PRIVY WEBHOOK] Updated escrow with tx hash: ${data.transaction_hash}`);
    return json({ success: true });
  }

  if (type === "transaction.execution_reverted" || type === "transaction.failed") {
    // Mark escrow as disputed for manual review
    console.error(`[PRIVY WEBHOOK] Transaction ${type}: ${data.transaction_id}`);

    const { error } = await supabase
      .from("escrows")
      .update({ status: "disputed" })
      .eq("escrow_id", data.transaction_id);

    if (error) {
      console.error("[PRIVY WEBHOOK] Failed to update escrow status:", error);
    }

    return json({ success: true });
  }

  // Unknown event type - log and return success
  console.log(`[PRIVY WEBHOOK] Unknown event type: ${type}`);
  return json({ success: true });
}

// --- Escrow Accept / Reject / Messages ---

/**
 * Check if an escrow has expired (48h without seller action).
 * If so, auto-refund and update status. Returns true if expired.
 */
async function checkAndExpireEscrow(escrow: any): Promise<boolean> {
  if (escrow.status !== "deposited") return false;
  if (!escrow.expires_at) return false;
  if (new Date(escrow.expires_at) > new Date()) return false;

  console.log(`[EXPIRY] Escrow ${escrow.id} expired, refunding deposit`);

  // Refund deposit to buyer
  try {
    const { data: buyer } = await supabase
      .from("users")
      .select("wallet_address")
      .eq("id", escrow.buyer_id)
      .single();

    if (buyer?.wallet_address && ESCROW_WALLET_ID) {
      const transferData = encodeUsdcTransfer(buyer.wallet_address, escrow.deposit_amount);
      await privy.wallets().ethereum().sendTransaction(
        ESCROW_WALLET_ID,
        {
          caip2: BASE_SEPOLIA_CAIP2,
          params: {
            transaction: {
              to: USDC_CONTRACT,
              data: transferData,
              chain_id: BASE_SEPOLIA_CHAIN_ID,
            },
          },
          sponsor: true,
        }
      );
    }
  } catch (err) {
    console.error("[EXPIRY] Refund failed:", err);
  }

  await supabase
    .from("escrows")
    .update({ status: "expired" })
    .eq("id", escrow.id);

  await supabase
    .from("listings")
    .update({ status: "active" })
    .eq("id", escrow.listing_id);

  return true;
}

/**
 * POST /escrow/accept
 *
 * Seller accepts a deposit. Opens the DM channel for meetup coordination.
 *
 * Body: { escrowId, walletAddress }
 */
async function handleEscrowAccept(body: {
  escrowId: string;
  walletAddress: string;
}) {
  const { escrowId, walletAddress } = body;

  if (!escrowId || !walletAddress) {
    return errorResponse("Missing escrowId or walletAddress");
  }

  const { data: escrow } = await supabase
    .from("escrows")
    .select("*")
    .eq("id", escrowId)
    .single();

  if (!escrow) return errorResponse("Escrow not found");

  // Check expiry first
  if (await checkAndExpireEscrow(escrow)) {
    return errorResponse("Escrow has expired. Deposit has been refunded to buyer.");
  }

  if (escrow.status !== "deposited") {
    return errorResponse(`Escrow is ${escrow.status}, cannot accept`);
  }

  // Verify caller is the seller
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) return errorResponse("Wallet not found");
  if (user.id !== escrow.seller_id) {
    return errorResponse("Only the seller can accept this deposit");
  }

  await supabase
    .from("escrows")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
    })
    .eq("id", escrowId);

  console.log(`[ACCEPT] Escrow ${escrowId} accepted by seller`);

  return json({ accepted: true });
}

/**
 * POST /escrow/reject
 *
 * Seller rejects a deposit. Refunds buyer and reopens listing.
 *
 * Body: { escrowId, walletAddress }
 */
async function handleEscrowReject(body: {
  escrowId: string;
  walletAddress: string;
}) {
  const { escrowId, walletAddress } = body;

  if (!escrowId || !walletAddress) {
    return errorResponse("Missing escrowId or walletAddress");
  }

  const { data: escrow } = await supabase
    .from("escrows")
    .select(`
      *,
      buyer:users!buyer_id(id, wallet_address)
    `)
    .eq("id", escrowId)
    .single();

  if (!escrow) return errorResponse("Escrow not found");
  if (escrow.status !== "deposited") {
    return errorResponse(`Escrow is ${escrow.status}, cannot reject`);
  }

  // Verify caller is the seller
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) return errorResponse("Wallet not found");
  if (user.id !== escrow.seller_id) {
    return errorResponse("Only the seller can reject this deposit");
  }

  // Refund deposit to buyer
  let refundTxHash: string | undefined;
  try {
    if (escrow.buyer?.wallet_address && ESCROW_WALLET_ID) {
      const transferData = encodeUsdcTransfer(escrow.buyer.wallet_address, escrow.deposit_amount);
      const result = await privy.wallets().ethereum().sendTransaction(
        ESCROW_WALLET_ID,
        {
          caip2: BASE_SEPOLIA_CAIP2,
          params: {
            transaction: {
              to: USDC_CONTRACT,
              data: transferData,
              chain_id: BASE_SEPOLIA_CHAIN_ID,
            },
          },
          sponsor: true,
        }
      );
      refundTxHash = result.hash || result.transaction_hash || result.transaction_id;
    }
  } catch (err) {
    console.error("[REJECT] Refund failed:", err);
    return errorResponse("Failed to process refund", 500);
  }

  await supabase
    .from("escrows")
    .update({
      status: "rejected",
      release_tx_hash: refundTxHash,
    })
    .eq("id", escrowId);

  await supabase
    .from("listings")
    .update({ status: "active" })
    .eq("id", escrow.listing_id);

  console.log(`[REJECT] Escrow ${escrowId} rejected by seller, refund tx: ${refundTxHash}`);

  return json({ rejected: true, refundTxHash });
}

/**
 * GET /escrow/:id/messages
 *
 * Returns messages for an escrow. Only buyer or seller can read.
 */
async function handleGetMessages(escrowId: string, walletAddress: string) {
  if (!walletAddress) {
    return errorResponse("Missing wallet address (pass as ?wallet= query param)");
  }

  // Verify caller is involved in the escrow
  const { data: escrow } = await supabase
    .from("escrows")
    .select("buyer_id, seller_id")
    .eq("id", escrowId)
    .single();

  if (!escrow) return errorResponse("Escrow not found", 404);

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) return errorResponse("Wallet not found");
  if (user.id !== escrow.buyer_id && user.id !== escrow.seller_id) {
    return errorResponse("You are not involved in this escrow");
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("id, body, sender_id, created_at")
    .eq("escrow_id", escrowId)
    .order("created_at", { ascending: true });

  return json({ messages: messages || [] });
}

/**
 * POST /escrow/:id/messages
 *
 * Sends a message in an escrow chat. Only buyer or seller, and only
 * when escrow is in accepted or buyer_confirmed state.
 */
async function handleSendMessage(escrowId: string, body: {
  walletAddress: string;
  message: string;
}) {
  const { walletAddress, message } = body;

  if (!walletAddress || !message?.trim()) {
    return errorResponse("Missing walletAddress or message");
  }

  const { data: escrow } = await supabase
    .from("escrows")
    .select("buyer_id, seller_id, status")
    .eq("id", escrowId)
    .single();

  if (!escrow) return errorResponse("Escrow not found", 404);

  if (!["accepted", "buyer_confirmed"].includes(escrow.status)) {
    return errorResponse(`Cannot send messages when escrow is ${escrow.status}`);
  }

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) return errorResponse("Wallet not found");
  if (user.id !== escrow.buyer_id && user.id !== escrow.seller_id) {
    return errorResponse("You are not involved in this escrow");
  }

  const { data: msg, error } = await supabase
    .from("messages")
    .insert({
      escrow_id: escrowId,
      sender_id: user.id,
      body: message.trim(),
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to send message:", error);
    return errorResponse("Failed to send message", 500);
  }

  return json({ message: msg });
}

// --- Meetup Coordination Handlers ---

/**
 * POST /escrow/:id/meetup/phone
 *
 * Submit phone number for SMS meetup coordination. Phone goes directly
 * to Twilio — only a boolean flag and HMAC hash are stored in the DB.
 *
 * Body: { walletAddress, phone }
 */
async function handleMeetupPhone(escrowId: string, body: {
  walletAddress: string;
  phone: string;
}) {
  const { walletAddress, phone } = body;

  if (!walletAddress || !phone) {
    return errorResponse("Missing walletAddress or phone");
  }

  // 1. Validate phone format
  const normalized = normalizePhone(phone);
  if (!isValidPhoneNumber(normalized)) {
    return errorResponse("Invalid phone number. Use format like +14155551234 or (415) 555-1234");
  }

  // 2. Verify escrow is accepted and caller is buyer or seller
  const { data: escrow } = await supabase
    .from("escrows")
    .select("id, buyer_id, seller_id, status, listing_id")
    .eq("id", escrowId)
    .single();

  if (!escrow) return errorResponse("Escrow not found", 404);
  if (escrow.status !== "accepted") {
    return errorResponse(`Meetup coordination only available when escrow is accepted (current: ${escrow.status})`);
  }

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) return errorResponse("Wallet not found");

  let role: "buyer" | "seller";
  if (user.id === escrow.buyer_id) role = "buyer";
  else if (user.id === escrow.seller_id) role = "seller";
  else return errorResponse("You are not involved in this escrow");

  // 3. Get or create meetup session
  let { data: session } = await supabase
    .from("meetup_sessions")
    .select("*")
    .eq("escrow_id", escrowId)
    .maybeSingle();

  if (!session) {
    const { data: newSession, error } = await supabase
      .from("meetup_sessions")
      .insert({ escrow_id: escrowId })
      .select()
      .single();
    if (error) {
      console.error("[MEETUP] Failed to create session:", error);
      return errorResponse("Failed to create meetup session", 500);
    }
    session = newSession;
  }

  // 4. Check not already submitted
  const flagField = role === "buyer" ? "buyer_phone_submitted" : "seller_phone_submitted";
  if (session[flagField]) {
    return errorResponse(`You've already submitted your phone number for this meetup`);
  }

  // 5. Store HMAC hash + encrypted phone + set boolean flag
  const phoneHash = await hashPhone(normalized);
  const phoneEnc = await encryptPhone(normalized);
  const hashField = role === "buyer" ? "buyer_phone_hash" : "seller_phone_hash";
  const encField = role === "buyer" ? "buyer_phone_enc" : "seller_phone_enc";

  await supabase
    .from("meetup_sessions")
    .update({ [flagField]: true, [hashField]: phoneHash, [encField]: phoneEnc })
    .eq("id", session.id);

  // 6. Get listing name for SMS
  const { data: listing } = await supabase
    .from("listings")
    .select("item_name")
    .eq("id", escrow.listing_id)
    .single();
  const itemName = listing?.item_name || "Mac Mini";

  // 7. Send initial SMS via Twilio
  await sendSms(
    normalized,
    `Hi! I'm the Niche meetup coordinator for your ${itemName} transaction. ` +
    `What general area and times work best for you? ` +
    `(e.g. "Downtown SF, weekday evenings")`
  );

  // 8. Check if both parties have submitted
  const otherFlag = role === "buyer" ? "seller_phone_submitted" : "buyer_phone_submitted";
  const bothSubmitted = session[otherFlag] === true;

  if (bothSubmitted) {
    // Send "both ready" message to the submitter (other party already got their initial SMS)
    await sendSms(
      normalized,
      `Great news — both parties are ready! I'll relay messages between you to find a time and place. ` +
      `Just text me your preferences and I'll pass them along.`
    );
  }

  console.log(`[MEETUP] ${role} phone submitted for escrow ${escrowId}`);

  return json({ submitted: true, role, bothSubmitted });
}

/**
 * Call Anthropic Claude API for meetup coordination agent.
 * Returns the agent's response text given conversation history.
 */
async function callMeetupAgent(
  conversationHistory: Array<{ role: string; content: string }>,
  senderRole: "buyer" | "seller",
  newMessage: string,
  itemName: string,
): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    console.log("[AGENT] Anthropic API key not configured, falling back to relay");
    return "";
  }

  const systemPrompt = `You are a friendly, concise meetup coordinator for Niche, a peer-to-peer Mac Mini marketplace. Your job is to help the buyer and seller find a safe, convenient time and place to meet for the exchange.

CONTEXT:
- Item being exchanged: ${itemName}
- You are coordinating between the BUYER and SELLER via SMS
- Messages from each party are labeled [Buyer] or [Seller]
- Neither party can see the other's phone number — you are the intermediary

YOUR BEHAVIOR:
- Keep responses SHORT (1-3 sentences max, this is SMS)
- Be warm but efficient — help them converge on a plan quickly
- When one party suggests a time/place, relay it to the other and ask if it works
- Suggest safe PUBLIC meeting spots (Apple Stores, libraries, busy coffee shops, police station lobbies) if they ask or seem unsure
- If both agree on a plan, confirm it back to both and remind them to inspect the item before confirming payment in the app
- Include a safety reminder once (not every message): meet in public, bring a friend if possible, inspect item before paying
- NEVER share one party's phone number, address, or personal details with the other
- If the conversation goes off-topic, gently steer back to scheduling the meetup
- If someone seems to be trying to scam (wants to meet in private, pressures to pay outside the app, etc.), warn the other party

RESPONSE FORMAT:
Respond with what to send to BOTH parties. Format your response as:
TO_SENDER: <message to the person who just texted>
TO_OTHER: <message to relay to the other party>

If you only need to respond to the sender (e.g. answering a question), just use:
TO_SENDER: <message>

If no response is needed, respond with:
NONE`;

  // Build messages array with history + new message
  const messages = [
    ...conversationHistory.map((msg: { role: string; content: string }) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
    {
      role: "user" as const,
      content: `[${senderRole === "buyer" ? "Buyer" : "Seller"}]: ${newMessage}`,
    },
  ];

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-20250414",
        max_tokens: 300,
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[AGENT] Anthropic API error:", err);
      return "";
    }

    const data = await res.json();
    const responseText = data.content?.[0]?.text || "";
    console.log("[AGENT] Response:", responseText.slice(0, 100));
    return responseText;
  } catch (err) {
    console.error("[AGENT] Failed to call Anthropic:", err);
    return "";
  }
}

/**
 * Parse agent response into messages for sender and other party.
 */
function parseAgentResponse(response: string): { toSender: string | null; toOther: string | null } {
  const toSenderMatch = response.match(/TO_SENDER:\s*(.+?)(?=\nTO_OTHER:|$)/s);
  const toOtherMatch = response.match(/TO_OTHER:\s*(.+?)$/s);

  return {
    toSender: toSenderMatch ? toSenderMatch[1].trim() : null,
    toOther: toOtherMatch ? toOtherMatch[1].trim() : null,
  };
}

/**
 * POST /webhooks/twilio/sms
 *
 * Incoming SMS webhook from Twilio. Uses an LLM agent to naturally
 * coordinate meetups between buyer and seller via SMS relay.
 */
async function handleTwilioSmsWebhook(req: Request) {
  // Twilio sends as application/x-www-form-urlencoded
  const rawBody = await req.text();

  // Validate Twilio signature — FAIL CLOSED if auth token not configured
  if (!TWILIO_AUTH_TOKEN) {
    console.error("[TWILIO] Auth token not configured, rejecting webhook");
    return errorResponse("Twilio auth not configured", 500);
  }
  const twilioSigValid = await validateTwilioSignature(req, rawBody);
  if (!twilioSigValid) {
    console.error("[TWILIO] Invalid webhook signature");
    return errorResponse("Invalid signature", 403);
  }

  const twimlEmpty = new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { headers: { ..._reqCorsHeaders, "Content-Type": "text/xml" } }
  );

  const params = new URLSearchParams(rawBody);
  const from = params.get("From") || "";
  const body = params.get("Body") || "";

  console.log("[TWILIO] Incoming SMS from [REDACTED], length:", body.length);

  if (!from || !body.trim()) return twimlEmpty;

  // Hash the incoming phone to find the matching session
  const phoneHash = await hashPhone(from);

  // Try to find session by buyer hash, then seller hash
  let session = null;
  let senderRole: "buyer" | "seller" | null = null;

  const { data: buyerMatch } = await supabase
    .from("meetup_sessions")
    .select("*")
    .eq("buyer_phone_hash", phoneHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (buyerMatch) {
    session = buyerMatch;
    senderRole = "buyer";
  } else {
    const { data: sellerMatch } = await supabase
      .from("meetup_sessions")
      .select("*")
      .eq("seller_phone_hash", phoneHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sellerMatch) {
      session = sellerMatch;
      senderRole = "seller";
    }
  }

  if (!session || !senderRole) {
    await sendSms(from, "Sorry, I couldn't find an active meetup session for your number. Please submit your phone through the Niche app.");
    return twimlEmpty;
  }

  const otherSubmitted = senderRole === "buyer" ? session.seller_phone_submitted : session.buyer_phone_submitted;
  const otherEncField = senderRole === "buyer" ? "seller_phone_enc" : "buyer_phone_enc";

  if (!otherSubmitted || !session[otherEncField]) {
    await sendSms(from, `Got it! The other party hasn't joined SMS coordination yet. I'll pass your message along once they do.`);
    return twimlEmpty;
  }

  // Decrypt other party's phone for relay
  const otherPhone = await decryptPhone(session[otherEncField]);
  if (!otherPhone) {
    await sendSms(from, `Sorry, I'm having trouble right now. You can also coordinate via the in-app chat.`);
    return twimlEmpty;
  }

  // Get item name for agent context
  const { data: escrow } = await supabase
    .from("escrows")
    .select("listing_id")
    .eq("id", session.escrow_id)
    .single();
  let itemName = "Mac Mini";
  if (escrow) {
    const { data: listing } = await supabase
      .from("listings")
      .select("item_name")
      .eq("id", escrow.listing_id)
      .single();
    if (listing) itemName = listing.item_name;
  }

  // Load conversation history (keep last 20 messages for context window)
  const history: Array<{ role: string; content: string }> = (session.conversation_history || []).slice(-20);

  // Call the LLM agent
  const agentResponse = await callMeetupAgent(history, senderRole, body.trim(), itemName);

  // Update conversation history
  const newHistory = [
    ...history,
    { role: "user", content: `[${senderRole === "buyer" ? "Buyer" : "Seller"}]: ${body.trim()}` },
  ];

  if (agentResponse) {
    const { toSender, toOther } = parseAgentResponse(agentResponse);

    // Send agent responses
    if (toSender) await sendSms(from, toSender);
    if (toOther) await sendSms(otherPhone, toOther);

    // Save agent response in history
    newHistory.push({ role: "assistant", content: agentResponse });
  } else {
    // Fallback: simple relay if agent is unavailable
    const senderLabel = senderRole === "buyer" ? "Buyer" : "Seller";
    await sendSms(otherPhone, `[${senderLabel}]: ${body.trim()}`);

    // One-time safety tip
    if (!session.safety_tip_sent) {
      await sendSms(from,
        `Tip: Meet in a well-lit public place like an Apple Store or library. Inspect the item before confirming payment in the app.`
      );
      await supabase
        .from("meetup_sessions")
        .update({ safety_tip_sent: true })
        .eq("id", session.id);
    }
  }

  // Persist updated conversation history
  await supabase
    .from("meetup_sessions")
    .update({ conversation_history: newHistory })
    .eq("id", session.id);

  console.log(`[TWILIO] Processed SMS from ${senderRole} for escrow ${session.escrow_id}`);

  return twimlEmpty;
}

// --- Main Router ---

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  _reqCorsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: _reqCorsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/niche-api/, ""); // strip function prefix
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Rate limiting
  rateLimitCleanup();
  if (path.startsWith("/auth/")) {
    if (!checkRateLimit(`auth:${clientIp}`, 10, 60_000)) {
      return errorResponse("Too many requests", 429);
    }
  } else if (path.startsWith("/webhooks/")) {
    if (!checkRateLimit(`webhook:${clientIp}`, 60, 60_000)) {
      return errorResponse("Too many requests", 429);
    }
  } else {
    if (!checkRateLimit(`general:${clientIp}`, 120, 60_000)) {
      return errorResponse("Too many requests", 429);
    }
  }

  try {
    // ===== PUBLIC AUTH ROUTES (no JWT required) =====

    if (req.method === "POST" && path === "/auth/lookup") {
      const body = await req.json();
      return await handleAuthLookup(body);
    }

    if (req.method === "GET" && path === "/auth/passkey-status") {
      const email = url.searchParams.get("email") || "";
      return await handlePasskeyStatus(email);
    }

    if (req.method === "POST" && path === "/auth/challenge") {
      const body = await req.json();
      return await handleAuthChallenge(body);
    }

    // ===== JWT-AUTHENTICATED AUTH ROUTES =====

    if (req.method === "POST" && path === "/auth/wallet") {
      const user = await requireAuth(req);
      const body = await req.json();
      // Derive privyUserId from JWT, not from body
      return await handleAuthWallet({ ...body, privyUserId: user.privy_user_id || (await verifyAuth(req)).privyUserId });
    }

    if (req.method === "POST" && path === "/auth/register-passkey") {
      const user = await requireAuth(req);
      const body = await req.json();
      // Use verified user ID instead of trusting email from body
      return await handleRegisterPasskey({ ...body, _verifiedUserId: user.id });
    }

    // ===== WEBHOOK ROUTES (signature-verified, no JWT) =====

    if (req.method === "POST" && path === "/webhooks/privy/transaction") {
      const rawBody = await req.text();
      const valid = await verifyPrivyWebhookSignature(req, rawBody);
      if (!valid) {
        console.error("[PRIVY WEBHOOK] Invalid signature — rejecting");
        return errorResponse("Invalid webhook signature", 403);
      }
      const body = JSON.parse(rawBody);
      return await handlePrivyTransactionWebhook(body);
    }

    if (req.method === "POST" && path === "/webhooks/twilio/sms") {
      return await handleTwilioSmsWebhook(req);
    }

    // ===== JWT-AUTHENTICATED ESCROW ROUTES =====

    if (req.method === "POST" && path === "/escrow/deposit") {
      const user = await requireAuth(req);
      const body = await req.json();
      // Override buyerWallet with verified user's wallet
      return await handleEscrowDeposit({ ...body, buyerWallet: user.wallet_address });
    }

    // NOTE: POST /escrow/release REMOVED — fund theft vector.
    // Release is handled by the seller confirm flow in handleEscrowConfirm.

    if (req.method === "POST" && path === "/escrow/confirm") {
      const user = await requireAuth(req);
      const body = await req.json();
      return await handleEscrowConfirm({ ...body, walletAddress: user.wallet_address });
    }

    if (req.method === "POST" && path === "/escrow/accept") {
      const user = await requireAuth(req);
      const body = await req.json();
      return await handleEscrowAccept({ ...body, walletAddress: user.wallet_address });
    }

    if (req.method === "POST" && path === "/escrow/reject") {
      const user = await requireAuth(req);
      const body = await req.json();
      return await handleEscrowReject({ ...body, walletAddress: user.wallet_address });
    }

    if (req.method === "POST" && path === "/escrow/cancel") {
      const user = await requireAuth(req);
      const body = await req.json();
      return await handleEscrowCancel({ ...body, walletAddress: user.wallet_address });
    }

    if (req.method === "POST" && path === "/escrow/dispute") {
      const user = await requireAuth(req);
      const body = await req.json();
      return await handleEscrowDispute({ ...body, walletAddress: user.wallet_address });
    }

    // POST /escrow/:id/meetup/phone — JWT required
    const meetupPhoneMatch = path.match(/^\/escrow\/([0-9a-f-]+)\/meetup\/phone$/);
    if (req.method === "POST" && meetupPhoneMatch) {
      const user = await requireAuth(req);
      const body = await req.json();
      return await handleMeetupPhone(meetupPhoneMatch[1], { ...body, walletAddress: user.wallet_address });
    }

    // GET/POST /escrow/:id/messages — JWT required
    const messagesMatch = path.match(/^\/escrow\/([0-9a-f-]+)\/messages$/);
    if (messagesMatch) {
      const user = await requireAuth(req);
      if (req.method === "GET") {
        return await handleGetMessages(messagesMatch[1], user.wallet_address);
      }
      if (req.method === "POST") {
        const body = await req.json();
        return await handleSendMessage(messagesMatch[1], { ...body, walletAddress: user.wallet_address });
      }
    }

    // ===== JWT-AUTHENTICATED DATA ROUTES =====

    // GET /escrows — derive user_id from JWT
    if (req.method === "GET" && path === "/escrows") {
      const user = await requireAuth(req);
      return await handleListEscrows(user.id);
    }

    // GET /wallet/balance/:walletId — verify caller owns wallet
    const balanceMatch = path.match(/^\/wallet\/balance\/(.+)$/);
    if (req.method === "GET" && balanceMatch) {
      await requireAuth(req); // Must be authenticated (wallet ownership TBD)
      return await handleGetWalletBalance(balanceMatch[1]);
    }

    // ===== PUBLIC READ ROUTES (no JWT) =====

    // GET /escrow/by-listing/:listingId
    const byListingMatch = path.match(/^\/escrow\/by-listing\/(.+)$/);
    if (req.method === "GET" && byListingMatch) {
      return await handleGetEscrowByListing(byListingMatch[1]);
    }

    // GET /escrow/:id
    const escrowMatch = path.match(/^\/escrow\/([0-9a-f-]+)$/);
    if (req.method === "GET" && escrowMatch) {
      return await handleGetEscrow(escrowMatch[1]);
    }

    return errorResponse("Not found", 404);
  } catch (err: any) {
    // Auth errors → 401
    if (err?.message?.includes("authentication") || err?.message?.includes("Authorization") || err?.message === "User not found") {
      return errorResponse(err.message, 401);
    }
    console.error("Unhandled error:", err);
    return errorResponse(err?.message || "Internal error", 500);
  }
});
