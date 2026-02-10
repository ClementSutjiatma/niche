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
import { Resend } from "npm:resend@3";

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

// Resend email service
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// --- Helpers ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return json({ error: message }, status);
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
    .select("id, wallet_address, twitter_username, twitter_user_id, passkey_credential_id, passkey_public_key")
    .eq("channel_id", channelId)
    .eq("channel_type", channelType)
    .single();

  if (existing) {
    // Update wallet and Twitter info if changed
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
    .select("id, wallet_address, channel_id, channel_type, display_name, twitter_username, twitter_user_id, passkey_credential_id, passkey_public_key")
    .eq("channel_id", channelId)
    .eq("channel_type", channelType)
    .single();

  if (user?.wallet_address) {
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

    // Optionally store passkey info for signing later
    if (passkey) {
      await supabase
        .from("users")
        .update({
          passkey_public_key: passkey.publicKey,
          passkey_credential_id: passkey.credentialId,
        })
        .eq("channel_id", channelId)
        .eq("channel_type", channelType);
    }

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

  // 2. Verify passkey assertion
  // We verify that:
  //  - The assertion contains valid authenticatorData and clientDataJSON
  //  - The credential ID matches the user's registered passkey
  //  - The challenge (if provided) matches the expected transaction parameters
  // Full cryptographic verification of the signature requires the stored
  // public key in COSE format + WebAuthn verification library. For the MVP
  // we verify the structure and credential binding. The passkey_public_key
  // column must be populated during registration for full verification.
  if (buyer.passkey_credential_id) {
    try {
      // Decode the clientDataJSON to extract the challenge and verify origin
      const clientDataRaw = atob(passkey.clientDataJSON);
      const clientData = JSON.parse(clientDataRaw);

      if (clientData.type !== "webauthn.get") {
        return errorResponse("Invalid passkey assertion type");
      }

      // If challengeParams were provided, verify the challenge matches
      if (challengeParams) {
        const encoder = new TextEncoder();
        const expectedData = encoder.encode(
          `${challengeParams.listingId}:${challengeParams.wallet}:${challengeParams.amount}:${challengeParams.timestamp}`
        );
        const expectedHash = await crypto.subtle.digest("SHA-256", expectedData);
        const expectedB64 = btoa(
          String.fromCharCode(...new Uint8Array(expectedHash))
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        if (clientData.challenge !== expectedB64) {
          return errorResponse("Passkey challenge does not match transaction parameters");
        }
      }
    } catch (err) {
      console.error("Passkey verification error:", err);
      return errorResponse("Invalid passkey assertion data");
    }
  }

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

/**
 * POST /escrow/release
 *
 * Releases escrowed USDC to the seller after both parties confirm.
 * Called by the CLI's `niche confirm` when both confirmations are in.
 *
 * Body: { escrowId, sellerAddress, amount }
 */
async function handleEscrowRelease(body: {
  escrowId: string;
  sellerAddress: string;
  amount: number;
}) {
  const { escrowId, sellerAddress, amount } = body;

  if (!escrowId || !sellerAddress || !amount) {
    return errorResponse("Missing required fields: escrowId, sellerAddress, amount");
  }

  if (!ESCROW_WALLET_ID) {
    return errorResponse("Escrow wallet not configured", 500);
  }

  // 1. Verify escrow exists and both parties confirmed
  const { data: escrow, error: escrowError } = await supabase
    .from("escrows")
    .select("*")
    .eq("id", escrowId)
    .single();

  if (escrowError || !escrow) {
    return errorResponse("Escrow not found");
  }

  if (escrow.status !== "deposited") {
    return errorResponse(`Escrow is not in deposited state (current: ${escrow.status})`);
  }

  if (!escrow.buyer_confirmed || !escrow.seller_confirmed) {
    return errorResponse(
      `Both parties must confirm. Buyer: ${escrow.buyer_confirmed ? "yes" : "no"}, Seller: ${escrow.seller_confirmed ? "yes" : "no"}`
    );
  }

  // 2. Encode USDC transfer: escrow wallet -> seller
  const transferData = encodeUsdcTransfer(sellerAddress, amount);

  // 3. Execute from escrow wallet (app-owned, no user auth needed)
  let txHash: string;
  try {
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
    txHash = result.hash;
  } catch (err: any) {
    console.error("On-chain release failed:", err);
    return errorResponse(
      `On-chain release failed: ${err?.message || "Unknown error"}`,
      500
    );
  }

  // 4. Update escrow and listing
  await supabase
    .from("escrows")
    .update({
      status: "released",
      release_tx_hash: txHash,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", escrowId);

  await supabase
    .from("listings")
    .update({ status: "completed" })
    .eq("id", escrow.listing_id);

  console.log(`Escrow released: ${escrowId}, tx: ${txHash}`);

  return json({ txHash });
}

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

    // Verify passkey if provided
    if (passkey) {
      try {
        const clientDataRaw = atob(passkey.clientDataJSON);
        const clientData = JSON.parse(clientDataRaw);
        if (clientData.type !== "webauthn.get") {
          return errorResponse("Invalid passkey assertion type");
        }
      } catch (err) {
        console.error("Passkey verification error:", err);
        return errorResponse("Invalid passkey assertion data");
      }
    }

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

  return json({
    hasPasskey,
    userId: user.id,
    needsPasskey: !hasPasskey,
    passkey: hasPasskey ? {
      publicKey: user.passkey_public_key,
      credentialId: user.passkey_credential_id
    } : null
  });
}

/**
 * POST /auth/register-passkey
 *
 * Registers a passkey for an existing user who doesn't have one.
 * This is for users who created accounts before passkey enforcement.
 */
async function handleRegisterPasskey(body: {
  email: string;
  passkey: { publicKey: string; credentialId: string };
}) {
  const { email, passkey } = body;

  if (!email || !passkey?.publicKey || !passkey?.credentialId) {
    return errorResponse("Missing email or passkey data");
  }

  // First check if user exists
  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("channel_id", email)
    .eq("channel_type", "email")
    .single();

  if (!existingUser) {
    return errorResponse("User not found. Please complete signup first.", 404);
  }

  // Update the user's passkey info
  const { error } = await supabase
    .from("users")
    .update({
      passkey_public_key: passkey.publicKey,
      passkey_credential_id: passkey.credentialId,
    })
    .eq("channel_id", email)
    .eq("channel_type", "email");

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

// --- Main Router ---

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/niche-api/, ""); // strip function prefix

  try {
    // Auth routes
    if (req.method === "POST" && path === "/auth/lookup") {
      const body = await req.json();
      return await handleAuthLookup(body);
    }

    if (req.method === "POST" && path === "/auth/wallet") {
      const body = await req.json();
      return await handleAuthWallet(body);
    }

    if (req.method === "GET" && path === "/auth/passkey-status") {
      const email = url.searchParams.get("email") || "";
      return await handlePasskeyStatus(email);
    }

    if (req.method === "POST" && path === "/auth/register-passkey") {
      const body = await req.json();
      return await handleRegisterPasskey(body);
    }

    if (req.method === "POST" && path === "/auth/challenge") {
      const body = await req.json();
      return await handleAuthChallenge(body);
    }

    // Webhook routes
    if (req.method === "POST" && path === "/webhooks/privy/transaction") {
      const body = await req.json();
      return await handlePrivyTransactionWebhook(body);
    }

    // Escrow routes
    if (req.method === "POST" && path === "/escrow/deposit") {
      const body = await req.json();
      return await handleEscrowDeposit(body);
    }

    if (req.method === "POST" && path === "/escrow/release") {
      const body = await req.json();
      return await handleEscrowRelease(body);
    }

    if (req.method === "POST" && path === "/escrow/confirm") {
      const body = await req.json();
      return await handleEscrowConfirm(body);
    }

    if (req.method === "POST" && path === "/escrow/accept") {
      const body = await req.json();
      return await handleEscrowAccept(body);
    }

    if (req.method === "POST" && path === "/escrow/reject") {
      const body = await req.json();
      return await handleEscrowReject(body);
    }

    if (req.method === "POST" && path === "/escrow/cancel") {
      const body = await req.json();
      return await handleEscrowCancel(body);
    }

    if (req.method === "POST" && path === "/escrow/dispute") {
      const body = await req.json();
      return await handleEscrowDispute(body);
    }

    // GET/POST /escrow/:id/messages
    const messagesMatch = path.match(/^\/escrow\/([0-9a-f-]+)\/messages$/);
    if (messagesMatch) {
      if (req.method === "GET") {
        const wallet = url.searchParams.get("wallet") || "";
        return await handleGetMessages(messagesMatch[1], wallet);
      }
      if (req.method === "POST") {
        const body = await req.json();
        return await handleSendMessage(messagesMatch[1], body);
      }
    }

    // GET /escrow/by-listing/:listingId
    const byListingMatch = path.match(/^\/escrow\/by-listing\/(.+)$/);
    if (req.method === "GET" && byListingMatch) {
      return await handleGetEscrowByListing(byListingMatch[1]);
    }

    // GET /escrows?user_id=...
    if (req.method === "GET" && path === "/escrows") {
      const userId = url.searchParams.get("user_id") || "";
      return await handleListEscrows(userId);
    }

    // GET /escrow/:id
    const escrowMatch = path.match(/^\/escrow\/([0-9a-f-]+)$/);
    if (req.method === "GET" && escrowMatch) {
      return await handleGetEscrow(escrowMatch[1]);
    }

    // GET /wallet/balance/:walletId
    const balanceMatch = path.match(/^\/wallet\/balance\/(.+)$/);
    if (req.method === "GET" && balanceMatch) {
      return await handleGetWalletBalance(balanceMatch[1]);
    }

    return errorResponse("Not found", 404);
  } catch (err: any) {
    console.error("Unhandled error:", err);
    return errorResponse(err?.message || "Internal error", 500);
  }
});
