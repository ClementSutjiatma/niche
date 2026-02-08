# Deploy niche-api Edge Function

## Quick Deploy

Run this command in your terminal (replace `YOUR_TOKEN` with your actual Supabase access token):

```bash
export SUPABASE_ACCESS_TOKEN=your_token_here
npx supabase functions deploy niche-api --project-ref uqedheymwswlbblximuq --no-verify-jwt
```

## Get Your Access Token

1. Go to https://supabase.com/dashboard/account/tokens
2. Create a new token or copy an existing one
3. Use it in the command above

## Alternative: One-liner

```bash
npx supabase functions deploy niche-api --project-ref uqedheymwswlbblximuq --no-verify-jwt --token YOUR_TOKEN_HERE
```

## What Gets Deployed

The updated `supabase/functions/niche-api/index.ts` includes:

### New Escrow Routes (currently returning 404)
- `POST /escrow/deposit` - Deposit USD into escrow with passkey auth
- `POST /escrow/release` - Release funds to seller after confirmation
- `POST /escrow/confirm` - Record buyer/seller meetup confirmation
- `POST /escrow/dispute` - File a dispute to freeze funds
- `GET /escrow/:id` - Get details for a specific escrow
- `GET /escrows?user_id=X` - List all escrows for a user
- `GET /escrow/by-listing/:listingId` - Check if listing has active escrow

### Existing Routes (unchanged, still working)
- `POST /auth/lookup` - Look up existing user by email
- `POST /auth/wallet` - Create or retrieve Privy wallet

## Verify Deployment

After deploying, test the escrow routes:

```bash
# Check if escrow routes are live
curl <YOUR_SUPABASE_URL>/functions/v1/niche-api/escrow/5cb4e881-9fba-416a-8307-cca64dcf1d42

# Should return escrow data instead of 404
```

## Troubleshooting

If deployment fails with npm package errors:
- The code uses `@privy-io/server-auth@1.15.0` which should resolve correctly
- If it still fails, check Supabase Edge Functions logs for specific errors
- Ensure all environment variables are set in Supabase dashboard:
  - `PRIVY_APP_ID`
  - `PRIVY_APP_SECRET`
  - `ESCROW_WALLET_ID` (optional, for on-chain escrow)
  - `ESCROW_WALLET_ADDRESS` (optional, for on-chain escrow)
