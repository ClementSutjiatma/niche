#!/usr/bin/env node

/**
 * One-time setup script: Create the platform escrow treasury wallet via Privy.
 *
 * This wallet is app-owned (no user_id owner), meaning the server can sign
 * transactions from it freely without user authorization. It holds USDC
 * during the escrow period.
 *
 * Usage:
 *   PRIVY_APP_ID=... PRIVY_APP_SECRET=... node scripts/create-escrow-wallet.js
 *
 * Or if you have a .env file:
 *   node --env-file=.env scripts/create-escrow-wallet.js
 *
 * Output: prints the wallet ID and address to store in Supabase Vault / env.
 */

async function main() {
  const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
  const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
    console.error("Missing PRIVY_APP_ID or PRIVY_APP_SECRET environment variables.");
    console.error("");
    console.error("Usage:");
    console.error("  PRIVY_APP_ID=<YOUR_PRIVY_APP_ID> PRIVY_APP_SECRET=<secret> node scripts/create-escrow-wallet.js");
    process.exit(1);
  }

  // Dynamic import since @privy-io/node is ESM
  const { PrivyClient } = await import("@privy-io/node");
  const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

  console.log("Creating escrow treasury wallet via Privy...\n");

  try {
    // Check if we already have one by listing app-owned wallets
    // (wallets with no user_id owner)
    const existing = await privy.wallets().list({
      chain_type: "ethereum",
    });

    // Look for a wallet that might already be our escrow wallet
    // (app-owned wallets don't have an owner.user_id)
    const appOwned = existing?.data?.filter(
      (w) => !w.owner || !w.owner.user_id
    );

    if (appOwned && appOwned.length > 0) {
      console.log("Found existing app-owned wallet(s):");
      for (const w of appOwned) {
        console.log(`  ID:      ${w.id}`);
        console.log(`  Address: ${w.address}`);
        console.log("");
      }
      console.log("If one of these is your escrow wallet, use its ID and address.");
      console.log("Otherwise, a new one will be created below.\n");
    }

    // Create a new app-owned wallet with a deterministic idempotency key
    const wallet = await privy.wallets().create({
      chain_type: "ethereum",
      "privy-idempotency-key": "niche-escrow-treasury-wallet-v1",
    });

    console.log("=== Escrow Treasury Wallet Created ===\n");
    console.log(`  ESCROW_WALLET_ID=${wallet.id}`);
    console.log(`  ESCROW_WALLET_ADDRESS=${wallet.address}`);
    console.log("");
    console.log("Next steps:");
    console.log("  1. Store these in Supabase Vault or as Edge Function env vars");
    console.log("  2. Fund this wallet with testnet USD from https://faucet.circle.com");
    console.log("     (The wallet receives USD from buyers, so it only needs gas ETH)");
    console.log("  3. Fund with Base Sepolia ETH from https://www.alchemy.com/faucets/base-sepolia");
    console.log("     (Or enable gas sponsorship in Privy dashboard to avoid needing ETH)");
  } catch (err) {
    console.error("Failed to create wallet:", err.message || err);
    process.exit(1);
  }
}

main();
