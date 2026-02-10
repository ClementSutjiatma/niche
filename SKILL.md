---
name: niche
description: "Mac Mini marketplace with partial USD deposits. Browse Mac Minis, deposit partial amounts, and complete purchases with secure on-chain escrow."
metadata:
  {
    "openclaw":
      {
        "emoji": "🖥️",
        "cron": [
          {
            "schedule": "*/15 * * * *",
            "command": "curl -s '<YOUR_SUPABASE_URL>/rest/v1/watches?select=*,users(id,channel_id,channel_type)' -H 'apikey: <YOUR_SUPABASE_ANON_KEY>' -H 'Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>'",
            "description": "Check for new Mac Minis matching user watches every 15 minutes. Agent should also query new listings since last check and match them against watches."
          }
        ],
      },
  }
---

# Niche — Mac Mini Marketplace with Partial Deposits

A peer-to-peer Mac Mini marketplace where users list, discover, and transact Mac Minis with partial USD deposits on Base Sepolia. Meet in person to inspect machines before completing payment.

## Architecture

All heavy logic (auth, signing, escrow, on-chain transactions) runs server-side on Supabase Edge Functions. The agent interacts directly via `curl` for data operations and `open` for browser-based flows (login, passkey signing, deposits).

```
Agent (curl + open)        →  Supabase
  curl to PostgREST             listings, watches, users (read/write)
  curl to Edge Functions         niche-api (auth, escrow, balance)
  open for browser               niche-ui (login, deposits, passkey signing)
  ~/.niche/auth.json             local auth state
```

**Hosted UI:** https://niche-henna.vercel.app

Anyone with the link can browse Mac Minis — no install needed.

## API Configuration

All API calls use these constants:

```
SUPABASE_URL  = <YOUR_SUPABASE_URL>
ANON_KEY      = <YOUR_SUPABASE_ANON_KEY>
REST_BASE     = $SUPABASE_URL/rest/v1
API_BASE      = $SUPABASE_URL/functions/v1/niche-api
UI_BASE       = https://niche-henna.vercel.app
AUTH_FILE      = ~/.niche/auth.json
```

**Headers for PostgREST calls** (REST_BASE):
```
-H "apikey: $ANON_KEY"
-H "Authorization: Bearer $ANON_KEY"
-H "Content-Type: application/json"
```

**Headers for Edge Function calls** (API_BASE):
```
-H "Authorization: Bearer $ANON_KEY"
-H "Content-Type: application/json"
```

## Why Partial Deposits + In-Person Inspection

- **Partial deposits** — Hold a Mac Mini with just $40-500 deposit, not full price
- **Meet & inspect** — Inspect the machine in person before final payment
- **Atomic payment** — Buyer confirms + pays remaining amount in single action
- **USD escrow** — All funds secured on-chain, released when both confirm
- **Buyer cancellation** — Get full refund before seller confirms meetup
- **Passkey signing** — Touch ID / Face ID to authorize transactions
- **Gas sponsored** — No ETH needed for transactions
- **Shareable links** — Send listing URLs to anyone, no app needed

## Transaction Flow

```
1. Seller lists "Mac Mini M4 Pro 24GB/1TB" for $1450 with $200 min deposit
2. Buyer deposits $200 USD → machine is held for buyer
3. Buyer can cancel anytime before seller confirms → full $200 refund
4. Both parties meet in person to inspect Mac Mini
5. Seller confirms they showed up
6. Buyer confirms AND pays $1250 remaining (atomic action)
7. Backend releases total $1450 to seller
```

## Database Schema

### Tables

**listings** — Mac Mini listings
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → users.id (seller) |
| item_name | TEXT | Mac Mini model name |
| item_description | TEXT | Mac Mini details/condition |
| price | NUMERIC | Total price in USD |
| min_deposit | NUMERIC | Minimum deposit required |
| category | TEXT | M4, M4 Pro, M4 Max, M2, M2 Pro, M2 Max, M1, M1 Pro |
| chip | TEXT | M4, M4 Pro, M4 Max, M2, M2 Pro, M2 Max, M1, M1 Pro |
| ram | INTEGER | GB (8, 16, 24, 32, 48, 64) |
| storage | INTEGER | GB (256, 512, 1024, 2048) |
| condition | TEXT | new, like-new, good, fair |
| year | INTEGER | e.g. 2024, 2023, 2020 |
| has_warranty | BOOLEAN | DEFAULT false |
| includes_box | BOOLEAN | DEFAULT false |
| includes_accessories | TEXT | e.g. "power cable, HDMI cable" |
| status | TEXT | active, pending, completed, cancelled, sold |
| created_at | TIMESTAMP | Auto-set |

**users** — Registered users
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| channel_id | TEXT | Email address or Twitter user ID |
| channel_type | TEXT | email, twitter, privy, simulated |
| wallet_address | TEXT | Ethereum wallet address (0x...) |
| display_name | TEXT | Email or @username |
| twitter_username | TEXT | Twitter/X username |
| twitter_user_id | TEXT | Twitter/X unique ID |
| passkey_public_key | TEXT | WebAuthn public key (base64) |
| passkey_credential_id | TEXT | WebAuthn credential ID (base64) |
| created_at | TIMESTAMP | Auto-set |

**watches** — Saved search alerts
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → users.id |
| categories | TEXT[] | Array of Mac Mini chip families to watch (M4 Pro, M4 Max, M2, etc.) |
| max_price | NUMERIC | Maximum price threshold |
| created_at | TIMESTAMP | Auto-set |

**escrows** — Payment escrow records
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| listing_id | UUID | FK → listings.id |
| buyer_id | UUID | FK → users.id |
| seller_id | UUID | FK → users.id |
| deposit_amount | NUMERIC | Amount deposited (min_deposit) |
| total_price | NUMERIC | Total purchase price |
| remaining_amount | NUMERIC | total_price - deposit_amount |
| currency | TEXT | Always 'USDC' |
| escrow_service | TEXT | onchain or simulated |
| escrow_id | TEXT | Transaction ID |
| status | TEXT | deposited, released, disputed, cancelled |
| buyer_confirmed | BOOLEAN | Buyer confirmed meetup + paid remaining |
| seller_confirmed | BOOLEAN | Seller confirmed meetup |
| deposit_tx_hash | TEXT | On-chain tx hash for deposit |
| release_tx_hash | TEXT | On-chain tx hash for release |
| remaining_payment_tx_hash | TEXT | Buyer's remaining payment tx hash |
| remaining_payment_confirmed_at | TIMESTAMP | When remaining payment confirmed |
| confirmed_at | TIMESTAMP | When escrow was released |
| created_at | TIMESTAMP | Auto-set |

## Auth State Management

Auth state is stored locally at `~/.niche/auth.json`. Read this file to check if the user is logged in.

**File format:**
```json
{
  "privyUserId": "did:privy:...",
  "wallet": "0x...",
  "walletId": "wallet_...",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "twitterUsername": "someuser",
  "provider": "twitter"
}
```

**Check if logged in:**
1. Read `~/.niche/auth.json`
2. If file doesn't exist or missing `wallet` field → not logged in
3. Extract `wallet` (flat string, the 0x address) for API calls
4. Extract `userId` for Supabase UUID (needed for all write operations — no DB lookup required)

**Login flow (agent-assisted, localhost callback):**
1. Start a temporary HTTP server on a random port to receive auth data:
```bash
# Start a one-shot HTTP server that captures the callback
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')
echo "Listening on port $PORT"
# Use a simple listener that captures the first request
python3 -c "
import http.server, urllib.parse, json, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        data = params.get('data', [''])[0]
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'<h1>Login complete! You can close this tab.</h1>')
        with open('$HOME/.niche/auth_callback.json', 'w') as f:
            f.write(data)
        sys.exit(0)
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', $PORT), H).handle_request()
" &
```
2. Open browser with callback URL: `open "https://niche-henna.vercel.app/login?callback=http://localhost:$PORT"`
3. User completes Twitter/X OAuth + passkey setup in browser
4. Browser automatically redirects to `http://localhost:$PORT?data={authJSON}` with auth data
5. Read the captured auth data and write `~/.niche/auth.json`:
```bash
# Read the callback data and write auth.json
mkdir -p ~/.niche
cp ~/.niche/auth_callback.json ~/.niche/auth.json
rm ~/.niche/auth_callback.json
```
6. Verify by reading back `~/.niche/auth.json` — should contain:
```json
{
  "privyUserId": "did:privy:...",
  "wallet": "0x...",
  "walletId": "wallet_...",
  "userId": "550e8400-...",
  "twitterUsername": "someuser",
  "provider": "twitter"
}
```

**Fallback login flow (if localhost callback fails):**
If the callback server doesn't receive data (e.g. browser blocks localhost redirect), fall back to manual lookup:
1. Ask the user for their Twitter/X username
2. Query: `GET /rest/v1/users?twitter_username=eq.<username>&select=id,wallet_address,display_name,twitter_username`
3. Write `~/.niche/auth.json` with `{ wallet, userId, twitterUsername, provider: "twitter" }`

**Logout:**
1. Delete `~/.niche/auth.json`

**Get user's Supabase UUID (needed for writes):**
Read directly from `~/.niche/auth.json` → `userId` field. No database lookup needed.

## Read Operations (PostgREST)

### Search Listings

Search active listings with optional filters. All filters are additive (AND logic).

```bash
curl -s '<YOUR_SUPABASE_URL>/rest/v1/listings?status=eq.active&select=id,item_name,price,min_deposit,category,item_description,chip,ram,storage,condition,year,has_warranty,created_at,users(display_name)&order=created_at.desc' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

**Available PostgREST filters** (append to URL as query params):
| Filter | Query Param | Example |
|--------|-------------|---------|
| Category (fuzzy) | `category=ilike.*M4 Pro*` | M4 Pro Mac Minis |
| Item name (fuzzy) | `item_name=ilike.*M4*` | Mac Minis with "M4" |
| Max price | `price=lte.1500` | Under $1500 |
| Min deposit threshold | `min_deposit=gte.100` | At least $100 deposit |

### Show Listing Detail

Look up a listing by full UUID:

```bash
curl -s '<YOUR_SUPABASE_URL>/rest/v1/listings?id=eq.<full-uuid>&select=*,users(display_name,channel_id,channel_type)' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

**Prefix ID matching:** PostgREST cannot use `like` on UUID columns. When the user provides a short ID prefix (e.g. `a1b2c3d4`), look it up from recent search results or context you already have. If not available, search all listings and match the prefix client-side from the `id` field.

### My Listings (requires auth)

```bash
curl -s '<YOUR_SUPABASE_URL>/rest/v1/listings?user_id=eq.<user-uuid>&select=*&order=created_at.desc' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

### My Watches (requires auth)

```bash
curl -s '<YOUR_SUPABASE_URL>/rest/v1/watches?user_id=eq.<user-uuid>&select=*&order=created_at.desc' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

### Escrow Status

**By escrow UUID:**
```bash
curl -s '<YOUR_SUPABASE_URL>/functions/v1/niche-api/escrow/<escrow-uuid>' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

**By listing ID:**
```bash
curl -s '<YOUR_SUPABASE_URL>/functions/v1/niche-api/escrow/by-listing/<listing-uuid>' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

**All user's escrows:**
```bash
curl -s '<YOUR_SUPABASE_URL>/functions/v1/niche-api/escrows?user_id=<user-uuid>' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

Returns: `{"escrows": [...]}`

**Via PostgREST (alternative for direct queries):**
```bash
curl -s '<YOUR_SUPABASE_URL>/rest/v1/escrows?or=(buyer_id.eq.<user-uuid>,seller_id.eq.<user-uuid>)&select=*,listings(id,item_name,price,min_deposit,category)&order=created_at.desc' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

## Write Operations (PostgREST)

### Post a Listing (requires auth)

First read `~/.niche/auth.json` to get the user's `userId` (Supabase UUID). This is used as `user_id` in the listing.

```bash
curl -s -X POST '<YOUR_SUPABASE_URL>/rest/v1/listings' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "user_id": "<user-uuid>",
    "item_name": "Mac Mini M4 Pro 24GB/1TB",
    "price": 1450,
    "min_deposit": 200,
    "category": "M4 Pro",
    "item_description": "Like-new, used for 3 months. Full Apple warranty.",
    "status": "active",
    "chip": "M4 Pro",
    "ram": 24,
    "storage": 1024,
    "condition": "like-new",
    "year": 2024,
    "has_warranty": true,
    "includes_box": true,
    "includes_accessories": "power cable, HDMI cable"
  }'
```

Returns the created listing with its UUID.

Validation rules:
- `item_name`, `price`, `min_deposit`, `chip`, `ram`, `storage`, `condition` are required
- `min_deposit` must be <= `price`
- `category` is optional but recommended (M4, M4 Pro, M4 Max, M2, M2 Pro, M2 Max, M1, M1 Pro)

### Cancel a Listing (requires auth)

Use the full UUID. If you only have a prefix, first resolve it by querying the user's listings and matching the prefix client-side.

```bash
# Step 1: If you need to resolve a prefix, fetch the user's listings
curl -s '<YOUR_SUPABASE_URL>/rest/v1/listings?user_id=eq.<user-uuid>&select=id,item_name,status&order=created_at.desc' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
# Then find the full UUID that starts with the prefix

# Step 2: Cancel with full UUID
curl -s -X PATCH '<YOUR_SUPABASE_URL>/rest/v1/listings?id=eq.<full-uuid>&user_id=eq.<user-uuid>' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"status": "cancelled"}'
```

### Create a Watch (requires auth)

```bash
curl -s -X POST '<YOUR_SUPABASE_URL>/rest/v1/watches' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "user_id": "<user-uuid>",
    "categories": ["M4 Pro", "M4 Max"],
    "max_price": 2000
  }'
```

### Delete a Watch (requires auth)

```bash
# Step 1: If you need to resolve a prefix, fetch the user's watches
curl -s '<YOUR_SUPABASE_URL>/rest/v1/watches?user_id=eq.<user-uuid>&select=id,categories,max_price&order=created_at.desc' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
# Then find the full UUID that starts with the prefix

# Step 2: Delete with full UUID
curl -s -X DELETE '<YOUR_SUPABASE_URL>/rest/v1/watches?id=eq.<full-uuid>&user_id=eq.<user-uuid>' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

## Edge Function Operations

### Wallet Balance

```bash
curl -s '<YOUR_SUPABASE_URL>/functions/v1/niche-api/wallet/balance/<wallet-id>' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

Note: Use the `wallet.id` from `~/.niche/auth.json` (not `wallet.address`). Returns `{"balance": "50.00"}`.

### Auth Lookup

Check if a user exists and has a wallet:

```bash
curl -s -X POST '<YOUR_SUPABASE_URL>/functions/v1/niche-api/auth/lookup' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "privyUserId": "<did:privy:...>",
    "twitterUsername": "<username>",
    "twitterUserId": "<twitter-numeric-id>"
  }'
```

Returns: `{"found": true, "wallet": "0x...", "walletId": "...", "userId": "..."}` or `{"found": false}`

### Escrow Confirm (Seller)

Seller confirms they showed up for the meetup. No passkey needed.

```bash
curl -s -X POST '<YOUR_SUPABASE_URL>/functions/v1/niche-api/escrow/confirm' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "escrowId": "<escrow-uuid>",
    "walletAddress": "<seller-wallet-address>"
  }'
```

Returns: `{"confirmed": true, "role": "seller", "released": false, "buyerConfirmed": false, "sellerConfirmed": true}`

If both parties have confirmed AND buyer has paid remaining, `released` will be `true` and funds are sent to seller automatically.

### Escrow Cancel (Buyer)

Buyer cancels deposit before seller confirms. Full refund.

```bash
curl -s -X POST '<YOUR_SUPABASE_URL>/functions/v1/niche-api/escrow/cancel' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "escrowId": "<escrow-uuid>",
    "walletAddress": "<buyer-wallet-address>"
  }'
```

Returns: `{"success": true, "refundTxHash": "0x..."}`

Rules:
- Only buyer can cancel
- Cannot cancel after seller confirms meetup

### Escrow Dispute

File a dispute, freezing escrowed funds for manual resolution.

```bash
curl -s -X POST '<YOUR_SUPABASE_URL>/functions/v1/niche-api/escrow/dispute' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "escrowId": "<escrow-uuid>",
    "walletAddress": "<wallet-address>",
    "reason": "Machine condition misrepresented"
  }'
```

Returns: `{"disputed": true, "reason": "Machine condition misrepresented"}`

### Escrow Release (manual trigger)

Releases escrowed funds to the seller. Normally happens automatically when both confirm, but can be called manually.

```bash
curl -s -X POST '<YOUR_SUPABASE_URL>/functions/v1/niche-api/escrow/release' \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "escrowId": "<escrow-uuid>",
    "sellerAddress": "<seller-wallet-address>",
    "amount": 1450
  }'
```

Returns: `{"txHash": "0x..."}`

## Browser Operations

These operations require browser interaction (passkey signing, Privy SDK, or external services). Use `open` to launch the URL.

| Operation | Command |
|-----------|---------|
| Login | `open "https://niche-henna.vercel.app/login?callback=http://localhost:$PORT"` |
| Browse all listings | `open "https://niche-henna.vercel.app/listings"` |
| View listing detail | `open "https://niche-henna.vercel.app/listing/<listing-uuid>"` |
| Deposit escrow (buyer) | `open "https://niche-henna.vercel.app/listing/<listing-uuid>#escrow"` |
| Confirm + pay remaining (buyer) | `open "https://niche-henna.vercel.app/listing/<listing-uuid>#confirm"` |
| Fund wallet (testnet faucet) | `open "https://faucet.circle.com"` |

**Login flow in browser:**
1. Twitter/X OAuth (Privy)
2. Passkey registration (Touch ID / Face ID)
3. Embedded wallet creation (server-side)
4. Auth state saved to browser localStorage
5. Browser redirects to localhost callback with auth data → agent writes `~/.niche/auth.json` automatically

**Deposit flow in browser:**
1. Listing detail page shows deposit form
2. User signs with passkey (Touch ID)
3. USDC transfer from user's embedded wallet to escrow wallet
4. Escrow record created in database

**Buyer confirmation flow in browser:**
1. User confirms they inspected the Mac Mini
2. Signs with passkey to pay remaining amount
3. If seller already confirmed → escrow releases automatically

## Check Matches (Cron)

The cron job checks for new listings matching active watches. Run this procedure:

1. Read last check timestamp from `~/.niche/config.json` (key: `lastMatchCheck`). Default to epoch if not set.

2. Query all watches:
```bash
curl -s '<YOUR_SUPABASE_URL>/rest/v1/watches?select=*,users(id,channel_id,channel_type)' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

3. Query new active listings since last check:
```bash
curl -s '<YOUR_SUPABASE_URL>/rest/v1/listings?status=eq.active&created_at=gt.<lastCheck>&select=*,users(id,channel_id,channel_type)&order=created_at.desc' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"
```

4. Match logic — for each new listing, check each watch:
   - Skip if watch.user_id == listing.user_id (don't match own listings)
   - Skip if watch.max_price is set AND listing.price > watch.max_price
   - Skip if watch.categories is set AND listing.category does not match any watch category (case-insensitive, e.g. "M4 Pro", "M4 Max")
   - If all filters pass → it's a match

5. Report matches grouped by user.

6. Update `~/.niche/config.json` with `"lastMatchCheck": "<current ISO timestamp>"`.

## Simulation / Testing Mode

For demos without real funds, create simulated users and escrows.

### Create a Simulated User

```bash
# Check if sim user exists
curl -s '<YOUR_SUPABASE_URL>/rest/v1/users?channel_id=eq.sim_seller1&channel_type=eq.simulated&select=*' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>"

# If not found (empty array), create one
curl -s -X POST '<YOUR_SUPABASE_URL>/rest/v1/users' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "channel_id": "sim_seller1",
    "channel_type": "simulated",
    "wallet_address": "0x73656c6c657231000000000000000000000000000",
    "display_name": "Simulated: seller1"
  }'
```

### Create a Simulated Escrow

```bash
curl -s -X POST '<YOUR_SUPABASE_URL>/rest/v1/escrows' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "listing_id": "<listing-uuid>",
    "buyer_id": "<buyer-user-uuid>",
    "seller_id": "<seller-user-uuid>",
    "deposit_amount": 200,
    "total_price": 1450,
    "remaining_amount": 1250,
    "currency": "USDC",
    "escrow_service": "simulated",
    "escrow_id": "sim_<timestamp>",
    "status": "deposited",
    "deposit_tx_hash": "sim_tx_<timestamp>"
  }'
```

After creating the escrow, also update the listing status to pending:
```bash
curl -s -X PATCH '<YOUR_SUPABASE_URL>/rest/v1/listings?id=eq.<listing-uuid>' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"status": "pending"}'
```

### Simulated Confirm

For simulated escrows, update the escrow directly:
```bash
# Seller confirm
curl -s -X PATCH '<YOUR_SUPABASE_URL>/rest/v1/escrows?id=eq.<escrow-uuid>' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"seller_confirmed": true}'

# Buyer confirm
curl -s -X PATCH '<YOUR_SUPABASE_URL>/rest/v1/escrows?id=eq.<escrow-uuid>' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"buyer_confirmed": true}'
```

If both confirmed, also mark as released:
```bash
curl -s -X PATCH '<YOUR_SUPABASE_URL>/rest/v1/escrows?id=eq.<escrow-uuid>' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"status": "released", "confirmed_at": "<ISO timestamp>", "release_tx_hash": "simulated-release-<timestamp>"}'

# And update listing to completed
curl -s -X PATCH '<YOUR_SUPABASE_URL>/rest/v1/listings?id=eq.<listing-uuid>' \
  -H "apikey: <YOUR_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <YOUR_SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

## Authentication Requirements

| Action | Without Login | With Login |
|--------|--------------|------------|
| Search / browse listings | Works | Works |
| Post listings | With simulate only | Works |
| Place deposit on Mac Mini | REQUIRES LOGIN (browser) | Real USD deposit |
| Confirm + pay (buyer) | REQUIRES LOGIN (browser) | Completes purchase |
| Confirm meetup (seller) | REQUIRES LOGIN (curl) | Confirms meetup |
| Cancel deposit | REQUIRES LOGIN (curl) | Get refund |
| Dispute | REQUIRES LOGIN (curl) | Holds funds |
| Fund wallet | REQUIRES LOGIN (browser) | Faucet |

## User Journey

```
1. BROWSE — curl search listings (no account needed)
2. VIEW   — open listing in browser
3. LOGIN  — agent starts localhost callback server → opens login page with ?callback → browser: Twitter OAuth → passkey → wallet → redirects to localhost → agent writes ~/.niche/auth.json
4. FUND   — open Circle faucet for testnet USD
5. DEPOSIT — open listing#escrow in browser (passkey signs deposit)
6. MEET   — Schedule in-person inspection of Mac Mini
7. SELLER CONFIRMS — curl POST to escrow/confirm (seller acknowledges meetup)
8. BUYER CONFIRMS + PAYS — open listing#confirm in browser (passkey signs remaining)
9. RELEASED — Backend releases total to seller automatically
```

## Example Agent Interactions

### First-Time User
```
User: "Find me an M4 Pro Mac Mini under $1500"

Agent: Reads ~/.niche/auth.json → file exists or not
Agent: curl GET listings with category=ilike.*M4 Pro*&price=lte.1500

Agent: "Found 2 M4 Pro Mac Minis:
  1. [a1b2c3d4] Mac Mini M4 Pro 24GB/512GB - $1,250 (min deposit: $200)
  2. [e5f6g7h8] Mac Mini M4 Pro 24GB/1TB - $1,450 (min deposit: $200)

Want to see any in your browser? Or interested in one?"

User: "I'm interested in #2"

Agent: Checks ~/.niche/auth.json → not found
Agent: "You'll need to login first. Setting up auth..."
Agent: Starts localhost callback server on random port
Agent: open "https://niche-henna.vercel.app/login?callback=http://localhost:PORT"
Agent: "Complete the Twitter/X login and passkey setup in your browser."
Agent: (browser redirects back to localhost with auth data automatically)
Agent: Writes ~/.niche/auth.json from callback data
Agent: "You're all set! Now let me place that deposit..."
```

### Listing a Mac Mini for Sale
```
User: "List my Mac Mini M4 Pro 24GB/1TB for $1450, like-new with warranty"

Agent: Reads ~/.niche/auth.json → found, userId exists
Agent: curl POST listings with:
  item_name: "Mac Mini M4 Pro 24GB/1TB"
  price: 1450
  min_deposit: 200
  category: "M4 Pro"
  chip: "M4 Pro"
  ram: 24
  storage: 1024
  condition: "like-new"
  year: 2024
  has_warranty: true
  item_description: "Like-new condition with full Apple warranty"

Agent: "Listed! Your Mac Mini M4 Pro 24GB/1TB is now active at $1,450.
        Listing ID: [a1b2c3d4]
        Min deposit: $200
        Share link: https://niche-henna.vercel.app/listing/<uuid>"
```

### Deposit Flow
```
User: "Place deposit on listing a1b2c3d4"

Agent: Reads ~/.niche/auth.json → found, wallet exists
Agent: open "https://niche-henna.vercel.app/listing/<full-uuid>#escrow"
Agent: "Opening the deposit page in your browser.
        Sign with your passkey (Touch ID) to deposit $200 USD.
        You'll pay the remaining $1,250 when you meet and confirm."
```

### Seller Confirmation
```
User: "I met the buyer. Confirm the meetup for listing a1b2c3d4."

Agent: Reads ~/.niche/auth.json → gets wallet address
Agent: curl GET escrow/by-listing/<listing-uuid> → gets escrow UUID
Agent: curl POST escrow/confirm with escrowId + walletAddress

Agent: "Confirmed! Waiting for buyer to confirm and pay remaining $1,250.
        Once both confirm, $1,450 total will be released to your wallet."
```

### Buyer Confirmation + Payment
```
User: "I met the seller and the Mac Mini looks great. Complete the purchase."

Agent: open "https://niche-henna.vercel.app/listing/<full-uuid>#confirm"
Agent: "Opening the confirmation page in your browser.
        Sign with your passkey to:
        1. Confirm you inspected the Mac Mini
        2. Pay the remaining $1,250 USD

        The seller will receive the total $1,450 once both confirm."
```

### Cancellation
```
User: "I need to cancel my deposit on listing a1b2c3d4"

Agent: Reads ~/.niche/auth.json → gets wallet address
Agent: curl GET escrow/by-listing/<listing-uuid> → gets escrow UUID
Agent: curl POST escrow/cancel with escrowId + walletAddress

Agent: "Cancelled. Your full $200 USD deposit has been refunded.
        Refund tx: 0x..."
```

### Full End-to-End Example
```
Seller: "List my Mac Mini M4 Pro 24GB/1TB for $1,450"
Agent: Creates listing [a1b2c3d4], min deposit $200

Buyer: "Find M4 Pro Mac Minis under $1,500"
Agent: Returns listing [a1b2c3d4] Mac Mini M4 Pro 24GB/1TB - $1,450

Buyer: "Deposit on a1b2c3d4"
Agent: Opens browser → buyer deposits $200 via passkey

Seller: "Confirm meetup for a1b2c3d4"
Agent: curl POST escrow/confirm → seller confirmed

Buyer: "Complete purchase of a1b2c3d4"
Agent: Opens browser → buyer pays remaining $1,250 via passkey
Agent: Both confirmed → $1,450 released to seller automatically
```

## Tips for Agents

1. **Always check auth first** — Read `~/.niche/auth.json` before any authenticated operation. If missing or no `wallet` field, start a localhost callback server and open the login page with `?callback=http://localhost:PORT`. The browser will redirect back with auth data automatically after login.
2. **Resolve prefix IDs** — Users give short IDs like `a1b2c3d4`. PostgREST cannot use `like` on UUID columns. Instead, use full UUIDs from recent search results/context, or fetch the relevant records (e.g. user's listings) and match the prefix client-side.
3. **User UUID is in auth.json** — The `userId` field in `~/.niche/auth.json` is the Supabase UUID. Use it directly for write operations. No database lookup needed.
4. **Offer to watch** — If search returns no results, offer to create a watch for that chip family.
5. **Show listing IDs** — Always show the first 8 characters of listing UUIDs for easy reference.
6. **Explain partial deposits** — Users deposit minimum amount, pay remaining at meetup after inspecting the Mac Mini.
7. **Prompt before confirming** — Confirming as buyer = paying remaining amount (real funds).
8. **Prompt before interest** — Deposits real USD to escrow.
9. **Simulation is for demos only** — Only use simulate mode when user explicitly asks to test.
10. **Browser vs curl** — Deposits, buyer confirmations, and login require the browser (passkey signing). Seller confirms, cancels, disputes, and all read operations use curl.
11. **Cancellation window** — Buyers can cancel anytime before seller confirms meetup.
12. **USD terminology** — Always say "USD" in user-facing messages. The underlying token is USDC on Base Sepolia testnet.
13. **Include machine specs** — When listing a Mac Mini, always include chip, RAM, storage, and condition for accurate matching.

## Sample Mac Minis (15 Available)

**M4** (3 machines):
- Mac Mini M4 16GB/256GB - $460 (min: $50)
- Mac Mini M4 16GB/512GB - $540 (min: $75)
- Mac Mini M4 24GB/512GB - $650 (min: $100)

**M4 Pro** (4 machines):
- Mac Mini M4 Pro 24GB/512GB - $1,250 (min: $200)
- Mac Mini M4 Pro 24GB/1TB - $1,450 (min: $200)
- Mac Mini M4 Pro 48GB/1TB - $1,800 (min: $300)
- Mac Mini M4 Pro 48GB/2TB - $2,100 (min: $350)

**M4 Max** (2 machines):
- Mac Mini M4 Max 36GB/1TB - $2,050 (min: $400)
- Mac Mini M4 Max 64GB/2TB - $2,800 (min: $500)

**M2** (2 machines):
- Mac Mini M2 8GB/256GB - $340 (min: $50)
- Mac Mini M2 16GB/512GB - $480 (min: $75)

**M2 Pro** (2 machines):
- Mac Mini M2 Pro 16GB/512GB - $820 (min: $120)
- Mac Mini M2 Pro 32GB/1TB - $1,100 (min: $180)

**M1** (2 machines):
- Mac Mini M1 8GB/256GB - $280 (min: $40)
- Mac Mini M1 16GB/512GB - $380 (min: $60)

## Testnet & On-Chain

All transactions use on-chain USDC on Base Sepolia testnet. No real funds at risk.

- USDC Contract (Base Sepolia): `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Gas is sponsored — users don't need ETH
- Get testnet USDC: https://faucet.circle.com (select Base Sepolia)

## Error Handling

| Error | Agent Response |
|-------|----------------|
| `~/.niche/auth.json` missing | Start localhost callback server, open login page with `?callback=http://localhost:PORT`. Auth data flows back automatically. |
| `~/.niche/auth.json` missing `wallet` | Same as above — need to re-login via localhost callback flow |
| No wallet | Login creates a wallet automatically |
| Insufficient USD | Open Circle faucet: `open "https://faucet.circle.com"` |
| Listing not found | Check ID prefix, or search again |
| `{"error": "..."}` from Edge Function | Display the error message to user |
| Already confirmed | Waiting for other party |
| Cannot cancel | Seller already confirmed. Buyer can only cancel before seller confirms. |
| PostgREST returns empty array `[]` | No matching records found |

## Data Storage

- **Supabase Postgres** — Users, listings, watches, escrows (with partial deposit tracking)
- **Supabase Vault** — Privy secrets, escrow private key
- **Edge Functions** — All server-side logic (Deno runtime)
- **Local** — `~/.niche/auth.json` (auth token + wallet), `~/.niche/config.json` (last match check timestamp)
