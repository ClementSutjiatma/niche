# Plan: Replace CLI with Direct API Instructions in SKILL.md

## Goal
Eliminate `cli.js` as the middleman. Instead, teach Claude (via SKILL.md) how to call the Supabase REST API and Edge Functions directly using `curl`. Claude already knows how to run bash commands — it just needs the right endpoints, headers, and payloads.

## What the CLI Currently Does

The CLI (`cli.js`) does two things:
1. **Data queries** — reads from Supabase Postgres via `@supabase/supabase-js` (search, list, show, watches, escrow status, etc.)
2. **Edge Function calls** — POSTs to `niche-api` Edge Function for auth, escrow, balance
3. **Browser opens** — opens the Vercel-hosted UI for login, deposit signing, browsing

All of these can be expressed as `curl` commands that Claude can execute directly.

## API Surface (What SKILL.md Needs to Document)

### Base URLs
- **Supabase REST API**: `<YOUR_SUPABASE_URL>/rest/v1/`
- **Edge Functions**: `<YOUR_SUPABASE_URL>/functions/v1/niche-api/`
- **Hosted UI**: `https://niche-henna.vercel.app`

### Auth Headers (all requests)
```
Authorization: Bearer <SUPABASE_ANON_KEY>
apikey: <SUPABASE_ANON_KEY>
Content-Type: application/json
```

The anon key: `<YOUR_SUPABASE_ANON_KEY>`

### Read Operations (Supabase REST / PostgREST)

| Operation | curl Command |
|-----------|-------------|
| Search listings | `GET /rest/v1/listings?status=eq.active&select=*,users(display_name)&order=created_at.desc` + optional filters like `&category=ilike.*Pokemon*&price=lte.100` |
| Show listing detail | `GET /rest/v1/listings?id=like.<prefix>*&select=*,users(display_name,channel_id,channel_type)` |
| My listings | `GET /rest/v1/listings?user_id=eq.<id>&select=*&order=created_at.desc` |
| My watches | `GET /rest/v1/watches?user_id=eq.<id>&select=*&order=created_at.desc` |
| Escrow by listing | `GET /rest/v1/escrows?listing_id=like.<prefix>*&select=*,listings(*)` |
| My escrows | `GET /rest/v1/escrows?or=(buyer_id.eq.<id>,seller_id.eq.<id>)&select=*,listings(item_name,price)&order=created_at.desc` |

### Write Operations (Supabase REST / PostgREST)

| Operation | curl Command |
|-----------|-------------|
| Post listing | `POST /rest/v1/listings` with body `{user_id, item_name, price, min_deposit, category, item_description, status: "active"}` + header `Prefer: return=representation` |
| Cancel listing | `PATCH /rest/v1/listings?id=eq.<id>&user_id=eq.<id>` with body `{status: "cancelled"}` |
| Create watch | `POST /rest/v1/watches` with body `{user_id, categories, max_price, min_deposit}` + header `Prefer: return=representation` |
| Delete watch | `DELETE /rest/v1/watches?id=eq.<id>&user_id=eq.<id>` |

### Edge Function Operations

| Operation | Endpoint | Method | Body |
|-----------|----------|--------|------|
| Auth lookup | `/functions/v1/niche-api/auth/lookup` | POST | `{privyUserId, email}` |
| Auth wallet | `/functions/v1/niche-api/auth/wallet` | POST | `{privyUserId, email}` |
| Balance | `/functions/v1/niche-api/wallet/balance/<walletId>` | GET | - |
| Escrow deposit | `/functions/v1/niche-api/escrow/deposit` | POST | `{listingId, buyerWallet, ...}` |
| Escrow confirm | `/functions/v1/niche-api/escrow/confirm` | POST | `{escrowId, walletAddress}` |
| Escrow cancel | `/functions/v1/niche-api/escrow/cancel` | POST | `{escrowId, walletAddress}` |
| Escrow dispute | `/functions/v1/niche-api/escrow/dispute` | POST | `{escrowId, walletAddress, reason}` |
| Get escrow | `/functions/v1/niche-api/escrow/<id>` | GET | - |
| Escrow by listing | `/functions/v1/niche-api/escrow/by-listing/<listingId>` | GET | - |
| List escrows | `/functions/v1/niche-api/escrows?user_id=<id>` | GET | - |

### Browser Operations (open URL)
| Operation | URL |
|-----------|-----|
| Login | `https://niche-henna.vercel.app/login` |
| Browse listings | `https://niche-henna.vercel.app/listings` |
| View listing | `https://niche-henna.vercel.app/listing/<id>` |
| Deposit escrow | `https://niche-henna.vercel.app/listing/<id>#escrow` |
| Fund wallet | `https://faucet.circle.com` |

### Local Auth State
The CLI stores auth in `~/.niche/auth.json`. Claude can read/write this file directly:
```json
{
  "authToken": "...",
  "privyUserId": "did:privy:...",
  "email": "user@example.com",
  "provider": "email",
  "wallet": { "address": "0x...", "id": "..." },
  "expiresAt": "..."
}
```

## Changes

### 1. Rewrite SKILL.md
Replace all CLI command references with direct `curl` commands and file operations. Structure:
- API configuration section with base URLs and headers
- Each operation documented as a curl command
- Auth state management via `~/.niche/auth.json`
- Browser opens via `open <url>` command

### 2. Files to NOT delete (yet)
- `cli.js` and `lib/auth.js` — keep for reference but mark as deprecated in SKILL.md
- The CLI can remain as an alternative but the skill should not depend on it

### 3. Remove CLI dependency from SKILL.md metadata
- Remove `"requires": { "bins": ["node"] }` since we no longer need node
- Update cron command from `niche check-matches` to a curl-based equivalent

## Implementation Steps

1. Rewrite `SKILL.md` with the full API reference and curl-based instructions
2. Test that all read operations work via curl
3. Verify Edge Function calls work via curl
