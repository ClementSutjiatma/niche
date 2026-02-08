# Niche System Architecture

## Component Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER'S MACHINE                                 │
│                                                                         │
│  ┌─────────────────────────────────┐   ┌──────────────────────────┐     │
│  │         CLI (cli.js)            │   │    ~/.niche/auth.json    │     │
│  │  Thin HTTP client, Node.js      │──▶│  privyUserId, email,     │     │
│  │  Uses: @supabase/supabase-js,   │   │  wallet, authToken,      │     │
│  │        open (browser launcher)  │   │  passkey credentials     │     │
│  │                                 │   └──────────────────────────┘     │
│  │  lib/auth.js                    │                                    │
│  │  Token storage & auth guards    │                                    │
│  └──────────┬──────────┬───────────┘                                    │
│             │          │                                                │
│        Direct DB    Opens browser                                       │
│        (anon key)   for auth/escrow                                     │
└─────────────┼──────────┼────────────────────────────────────────────────┘
              │          │
              │          ▼
              │   ┌─────────────────────────────────────────────────┐
              │   │          VERCEL (niche-ui-zeta.vercel.app)      │
              │   │          Next.js 15 App Router                  │
              │   │                                                 │
              │   │  Server Components (data fetching, SSR)         │
              │   │  ┌──────────────┐  ┌───────────────────┐       │
              │   │  │ app/page.tsx │  │ app/listings/     │       │
              │   │  │ Home + search│  │ page.tsx          │       │
              │   │  └──────────────┘  │ Server-side fetch │       │
              │   │  ┌──────────────────┘ + listing grid   │       │
              │   │  │ app/listing/[id]/                    │       │
              │   │  │ page.tsx  (SSR detail)               │       │
              │   │  │ listing-actions.tsx (client: escrow) │       │
              │   │  └─────────────────────────────────────┘       │
              │   │  ┌──────────────────────────────────────┐       │
              │   │  │ app/login/                           │       │
              │   │  │ login-form.tsx (client: Privy +      │       │
              │   │  │   email OTP + passkey + WebAuthn)    │       │
              │   │  └──────────────────────────────────────┘       │
              │   │                                                 │
              │   │  Shared: components/, lib/ (api, auth, types)   │
              │   │  Auth state: localStorage (niche_auth key)      │
              │   └──────────────────┬──────────────────────────────┘
              │                      │
              │                      │ fetch() from server & client components
              ▼                      ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │             SUPABASE (uqedheymwswlbblximuq.supabase.co)         │
   │                                                                  │
   │  ┌─────────────────────────────────────────────────────────┐     │
   │  │              Edge Functions (Deno runtime)               │     │
   │  │                                                         │     │
   │  │  niche-api          niche-escrow        niche-sign      │     │
   │  │  ├─ GET /listings   ├─ POST /deposit    (passkey        │     │
   │  │  ├─ GET /listings/:id├─ POST /release   verification)   │     │
   │  │  ├─ GET /balance/:addr                                  │     │
   │  │  ├─ POST /auth/lookup                                   │     │
   │  │  ├─ POST /auth/wallet                                   │     │
   │  │  └─ POST /fund/url                                      │     │
   │  └─────────────────────────────────────────────────────────┘     │
   │                                                                  │
   │  ┌─────────────────────────────────────────────────────────┐     │
   │  │              Postgres Database                           │     │
   │  │                                                         │     │
   │  │  Tables: users, listings, watches, escrows              │     │
   │  │  Access: direct via anon key (RLS) + Edge Functions     │     │
   │  └─────────────────────────────────────────────────────────┘     │
   │                                                                  │
   │  ┌─────────────┐                                                 │
   │  │ Vault       │  Stores: Privy secret, escrow private key,     │
   │  │             │          MoonPay API key                        │
   │  └─────────────┘                                                 │
   └─────────────────────────┬───────────────────────────┬────────────┘
                             │                           │
                             ▼                           ▼
                ┌────────────────────┐     ┌──────────────────────┐
                │   PRIVY (Auth)     │     │   BASE SEPOLIA       │
                │                    │     │   (Blockchain)       │
                │  Email OTP service │     │                      │
                │  Wallet creation   │     │  USD Contract:       │
                │  Server-side sign  │     │  0x036CbD...3dCF7e   │
                │  Gas sponsorship   │     │                      │
                └────────────────────┘     │  Escrow operations:  │
                                           │  deposit, release    │
                ┌────────────────────┐     │  Gas: sponsored      │
                │   MOONPAY          │     └──────────────────────┘
                │   Fiat on-ramp     │
                │   Credit card →    │
                │   USD              │
                └────────────────────┘
```

## Communication Protocols

| From | To | Method | Auth |
|---|---|---|---|
| CLI → Supabase Postgres | `@supabase/supabase-js` | Anon key (RLS) |
| CLI → niche-api Edge Function | `fetch()` | Anon key + `X-Auth-Token` |
| CLI → Vercel UI | `open` (browser) | None (public) |
| Vercel (server components) → niche-api | `fetch()` server-side, `cache: "no-store"` | Anon key |
| Vercel (client components) → niche-api | `fetch()` from browser | Anon key |
| Vercel (login-form) → Privy | `@privy-io/js-sdk-core` (npm, dynamic import) | Privy App ID |
| niche-api → Privy | Server SDK | Privy App Secret (from Vault) |
| niche-api → MoonPay | Signed URL generation | MoonPay key (from Vault) |
| niche-escrow → Base Sepolia | Ethers.js / Viem | Escrow private key (from Vault) |
| CLI → niche-escrow | `fetch()` | Anon key |

---

## Vercel Frontend (niche-ui)

The UI is a **Next.js 15 App Router** project using React, TypeScript, Tailwind CSS v4, and pnpm. It uses React Server Components for data fetching and Client Components for interactive auth/escrow flows.

### Server vs Client Component Split

| Component | Type | Why |
|-----------|------|-----|
| `app/page.tsx` | Server | Static home page, no data fetching |
| `app/listings/page.tsx` | Server | Fetches listings from Supabase via `apiFetch()` at request time |
| `app/listing/[id]/page.tsx` | Server | Fetches listing detail, renders static content |
| `app/listing/[id]/listing-actions.tsx` | Client | Auth-dependent buttons, WebAuthn escrow signing |
| `app/login/login-form.tsx` | Client | Privy SDK, OTP flow, passkey registration, WebAuthn |
| `components/nav.tsx` | Client | Reads `localStorage` auth state, dropdown toggle |
| `components/search-form.tsx` | Client | Form state with `defaultValue` |
| `components/listing-card.tsx` | Server | Pure display, no interactivity |

### Shared Libraries (niche-ui/lib/)

| File | Contents |
|------|----------|
| `api.ts` | `apiFetch<T>()` generic fetcher (adds Supabase anon key headers, `cache: "no-store"`), `formatDate()`, constants (`API_BASE`, `SUPABASE_ANON_KEY`, `PRIVY_APP_ID`) |
| `auth.ts` | `getAuth()`, `saveAuth()`, `clearAuth()` — `localStorage` wrappers with SSR safety (`typeof window` check) |
| `types.ts` | `Listing`, `ListingDetail`, `ListingUser`, `ListingsResponse`, `ListingResponse`, `AuthState` |

### Styling

Tailwind CSS v4 with custom theme colors defined in `app/globals.css` via `@theme`:

| Token | Value | Usage |
|-------|-------|-------|
| `brand` | `#f5a623` | Accent color (links, prices, buttons) |
| `brand-hover` | `#e09510` | Button hover states |
| `surface` | `#0a0a0f` | Body background |
| `card` | `rgba(255,255,255,0.04)` | Card backgrounds |
| `edge` | `rgba(255,255,255,0.08)` | Borders |
| `success` | `#4ade80` | Wallet addresses, confirmations |
| `error` | `#f87171` | Error messages |

---

## Renter's Flow (Buyer)

```
RENTER (looking for a sublet)
│
├─ 1. DISCOVER ─────────────────────────────────────────────────────
│    │
│    ├─ CLI: `niche search --neighborhood "East Village"`
│    │   └─▶ Supabase Postgres (direct read, anon key)
│    │       └─▶ SELECT * FROM listings WHERE status='active'
│    │
│    ├─ CLI: `niche browse`
│    │   └─▶ Opens browser → Vercel /listings
│    │       └─▶ Server component fetches from niche-api /listings
│    │           └─▶ Renders React listing grid (SSR)
│    │
│    └─ CLI: `niche view <id>` or `niche show <id>`
│        ├─ view: Opens browser → Vercel /listing/:id
│        │   └─▶ Server component fetches from niche-api → SSR React page
│        └─ show: Direct Supabase Postgres read → terminal output
│
├─ 2. AUTHENTICATE ─────────────────────────────────────────────────
│    │
│    CLI: `niche login`
│    └─▶ Opens browser → Vercel /login
│        │
│        ├─ Step 1: Email → Privy SDK sends OTP (login-form.tsx, client)
│        ├─ Step 2: User enters 6-digit code → Privy verifies
│        │   └─▶ POST niche-api /auth/lookup (check existing wallet)
│        │       └─▶ If found: save to localStorage, done
│        ├─ Step 3: Register passkey (Touch ID / Face ID)
│        │   └─▶ WebAuthn navigator.credentials.create()
│        └─ Step 4: Create wallet
│            └─▶ POST niche-api /auth/wallet
│                └─▶ Edge Function → Privy server-side wallet creation
│                    └─▶ Wallet address saved to:
│                        ├─ localStorage (browser: niche_auth)
│                        └─ ~/.niche/auth.json (CLI reads later)
│
├─ 3. FUND WALLET ──────────────────────────────────────────────────
│    │
│    CLI: `niche fund 2200`
│    └─▶ POST niche-api /fund/url
│        └─▶ Edge Function signs MoonPay URL (using Vault key)
│            └─▶ Opens browser → MoonPay widget
│                └─▶ Credit card/Apple Pay → USD → user's wallet
│        (Fallback: Circle faucet for free testnet USD)
│
├─ 4. DEPOSIT ESCROW ───────────────────────────────────────────────
│    │
│    CLI: `niche interest <listing-id>`
│    └─▶ Opens browser → Vercel /listing/:id#escrow
│        │
│        ├─ listing-actions.tsx (client component) detects #escrow hash
│        ├─ Shows escrow panel with amount, wallet, listing info
│        ├─ User clicks "Sign & Deposit"
│        │   └─▶ WebAuthn navigator.credentials.get() (passkey)
│        │       └─▶ Touch ID / Face ID signature
│        └─▶ POST niche-api /escrow/deposit
│            Body: { listingId, buyerWallet, amount, passkey signature }
│            └─▶ Edge Function:
│                ├─ Verifies passkey
│                ├─ Calls niche-escrow (on-chain USD transfer)
│                │   └─▶ Base Sepolia: USD locked in escrow contract
│                └─ INSERT INTO escrows (status: 'deposited')
│                    UPDATE listings SET status = 'pending'
│
├─ 5. MEET UP ──────────────────────────────────────────────────────
│    │  (Off-platform — schedule viewing, meet in person)
│    │
│
├─ 6. CONFIRM ──────────────────────────────────────────────────────
│    │
│    CLI: `niche confirm <listing-id>`
│    └─▶ Supabase Postgres:
│        ├─ UPDATE escrows SET buyer_confirmed = true
│        └─ If BOTH buyer_confirmed AND seller_confirmed:
│            └─▶ POST niche-escrow /release
│                Body: { escrowId, sellerAddress, amount }
│                └─▶ On-chain: USD released from escrow → seller wallet
│                    UPDATE escrows SET status = 'released'
│                    UPDATE listings SET status = 'completed'
│
└─ 6b. DISPUTE (alternative) ──────────────────────────────────────
     │
     CLI: `niche dispute <listing-id> --reason "..."`
     └─▶ Supabase Postgres:
         UPDATE escrows SET status = 'disputed'
         (Funds held pending resolution)
```

---

## Leaser's Flow (Seller)

```
LEASER (has a sublet to rent out)
│
├─ 1. AUTHENTICATE ─────────────────────────────────────────────────
│    │  (Same flow as Renter — email OTP → passkey → wallet)
│    │
│    CLI: `niche login` → browser → Privy → wallet created
│
├─ 2. POST LISTING ─────────────────────────────────────────────────
│    │
│    CLI: `niche post --neighborhood "East Village" --price 2200 --rooms 1`
│    └─▶ Supabase Postgres (direct insert, anon key):
│        INSERT INTO listings (user_id, neighborhood, price, rooms, status)
│        │
│        └─▶ Immediately checks for matching watches:
│            SELECT * FROM watches WHERE criteria matches
│            └─▶ Prints matched watchers to terminal
│                (Notification delivery is manual/future feature)
│
├─ 3. MANAGE LISTINGS ──────────────────────────────────────────────
│    │
│    ├─ CLI: `niche list`
│    │   └─▶ Supabase Postgres: SELECT * FROM listings WHERE user_id = me
│    │
│    └─ CLI: `niche cancel <id>`
│        └─▶ Supabase Postgres: UPDATE listings SET status = 'cancelled'
│
├─ 4. RECEIVE INTEREST (passive) ───────────────────────────────────
│    │
│    │  When a renter deposits escrow, listing status changes to 'pending'
│    │  Seller sees this via: `niche list` or `niche escrow`
│    │
│    CLI: `niche escrow`
│    └─▶ Supabase Postgres:
│        SELECT * FROM escrows WHERE seller_id = me
│        (Shows escrow status, buyer/seller confirmations)
│
├─ 5. MEET UP ──────────────────────────────────────────────────────
│    │  (Off-platform)
│    │
│
└─ 6. CONFIRM ──────────────────────────────────────────────────────
     │
     CLI: `niche confirm <listing-id>`
     └─▶ Supabase Postgres:
         UPDATE escrows SET seller_confirmed = true
         └─ If BOTH confirmed:
             └─▶ niche-escrow /release → USD sent to seller's wallet
```

---

## Watch/Match System (Cron)

```
WATCHER SETUP:
  CLI: `niche watch --neighborhood "East Village,LES" --max-price 2500`
  └─▶ Supabase Postgres: INSERT INTO watches

MATCH CHECK (runs every 15 minutes via cron):
  CLI: `niche check-matches`
  └─▶ Supabase Postgres:
      ├─ SELECT * FROM watches (all users' watches)
      ├─ SELECT * FROM listings WHERE created_at > lastCheck
      └─▶ Cross-match: listings vs watch criteria
          (neighborhood, max_price, min_rooms)
          └─▶ Print matches to terminal (future: push notification)
```

---

## Database Schema

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    users     │     │   listings   │     │   escrows    │     │   watches    │
├──────────────┤     ├──────────────┤     ├──────────────┤     ├──────────────┤
│ id (uuid)    │◀─┐  │ id (uuid)    │◀─┐  │ id (uuid)    │     │ id (uuid)    │
│ channel_id   │  │  │ user_id (fk) │──┘  │ listing_id   │─▶   │ user_id (fk) │
│ channel_type │  │  │ neighborhood │     │ buyer_id     │─▶   │ neighborhoods│
│ wallet_addr  │  │  │ price        │     │ seller_id    │─▶   │ max_price    │
│ display_name │  │  │ rooms        │     │ amount       │     │ min_rooms    │
│ created_at   │  │  │ description  │     │ currency     │     │ created_at   │
└──────────────┘  │  │ date_start   │     │ escrow_service│    └──────────────┘
                  │  │ date_end     │     │ escrow_id    │
                  │  │ status       │     │ status       │
                  │  │ created_at   │     │ buyer_confirmed│
                  │  └──────────────┘     │ seller_confirmed│
                  │                       │ deposit_tx_hash│
                  └───────────────────────│ release_tx_hash│
                     (buyer_id, seller_id)│ confirmed_at │
                                          └──────────────┘

Statuses:
  listings: active → pending → completed | cancelled
  escrows:  deposited → released | disputed
```

---

## Architectural Notes

1. **Dual data path** — The CLI reads Supabase Postgres directly (anon key + RLS) for read-heavy operations like `search`, `show`, `list`. It only goes through Edge Functions for operations requiring secrets (auth, escrow, balance, funding).

2. **Split auth storage** — The browser stores auth in `localStorage` (key: `niche_auth`), while the CLI reads from `~/.niche/auth.json`. There's no automatic sync mechanism between them — login happens in the browser, and the CLI relies on auth.json being populated (likely manually or via a callback that's not fully wired up yet).

3. **Passkey signs escrow, not transactions directly** — The WebAuthn passkey proves the user's intent to deposit. The actual on-chain USD transfer is executed server-side by the Edge Function using a private key stored in Supabase Vault.

4. **No push notifications yet** — Watch matches are printed to stdout. The cron job runs `check-matches` every 15 minutes, but delivery to users (via their channel_type/channel_id) isn't implemented — it just logs who should be notified.

5. **Simulation mode is a full parallel path** — `--simulate` creates real database records with fake wallets and simulated escrow service, bypassing all auth, passkey, and on-chain logic. It's a complete testing bypass.

6. **Server components fetch data without client round-trips** — Listing and detail pages use React Server Components that call the Supabase API at request time (`cache: "no-store"`). The HTML is fully rendered on the server, so users see content immediately without loading spinners. Only interactive elements (escrow panel, login flow, nav auth state) hydrate as client components.

7. **Privy SDK loaded dynamically** — `@privy-io/js-sdk-core` is installed as an npm dependency but imported via dynamic `import()` inside a `useEffect` to avoid SSR issues (the SDK accesses browser-only APIs). This means the Privy SDK only loads when the login page is visited in the browser.

---

## File Reference

| File | Role |
|------|------|
| `cli.js` | Main CLI entry point — thin HTTP client, command router |
| `lib/auth.js` | Token storage, `requireAuth()`, `isAuthenticated()` |
| `niche-ui/app/layout.tsx` | Root layout — dark theme, `<Nav>`, Tailwind globals |
| `niche-ui/app/page.tsx` | Home page — search form |
| `niche-ui/app/listings/page.tsx` | Browse page — server-side fetch, listing card grid |
| `niche-ui/app/listing/[id]/page.tsx` | Detail page — server-side fetch, listing info |
| `niche-ui/app/listing/[id]/listing-actions.tsx` | Client component — escrow deposit UI + WebAuthn signing |
| `niche-ui/app/login/page.tsx` | Login wrapper (Suspense boundary) |
| `niche-ui/app/login/login-form.tsx` | Auth flow — email OTP → passkey → wallet creation (Privy) |
| `niche-ui/components/nav.tsx` | Nav bar — auth state dropdown, logout |
| `niche-ui/components/listing-card.tsx` | Reusable listing card |
| `niche-ui/components/search-form.tsx` | Search form with neighborhood/price/rooms filters |
| `niche-ui/lib/api.ts` | `apiFetch()`, `formatDate()`, `API_BASE`, `PRIVY_APP_ID` |
| `niche-ui/lib/auth.ts` | Browser auth helpers — `getAuth()`, `saveAuth()`, `clearAuth()` |
| `niche-ui/lib/types.ts` | TypeScript interfaces — `Listing`, `AuthState`, etc. |
| `supabase/functions/niche-api/index.ts` | Edge Function: `/auth/lookup`, `/auth/wallet`, `/listings`, etc. |
| `docs/auth-model.md` | Authentication model documentation |
| `~/.niche/auth.json` | Local auth state (token, wallet, passkey) |
