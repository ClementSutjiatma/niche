# Niche

A peer-to-peer trading card marketplace with on-chain USDC escrow on Base. Buyers and sellers coordinate in-person meetups with funds held in escrow until both parties confirm the trade.

## How It Works

1. **Seller lists a card** with a price and minimum deposit
2. **Buyer places a deposit** (USDC on Base Sepolia) to claim the listing
3. **Seller accepts or rejects** within 48 hours (auto-refund if no response)
4. **Buyer and seller chat** in-app to arrange an in-person meetup
5. **Buyer inspects the card**, then confirms and pays the remaining amount
6. **Seller confirms the handoff**, releasing the full payment to their wallet

Escrow protects both parties: the buyer's deposit is locked until the seller accepts, and the full payment is only released when the seller confirms delivery.

## Architecture

```
niche-ui (Next.js)          CLI (Node.js)
     |                           |
     +--- Supabase Edge Function (Deno) ---+
     |         (niche-api)                  |
     +--- Supabase Postgres ---------------+
     |
     +--- Privy (auth + wallets) ----------+
     |
     +--- Base Sepolia (USDC on-chain) ----+
```

- **Frontend**: Next.js 15 + React 19, deployed to Vercel
- **Backend**: Supabase Edge Function (Deno runtime)
- **Database**: Supabase Postgres
- **Auth**: Twitter/X login via Privy SDK
- **Wallets**: Privy server-side wallets with passkey (Touch ID / Face ID) authorization
- **Payments**: USDC on Base Sepolia (testnet)

## Project Structure

```
skills/niche/
  cli.js                    # CLI client (niche list, niche deposit, etc.)
  lib/auth.js               # CLI auth helpers
  niche-ui/                 # Next.js frontend
    app/                    # App router pages
      page.tsx              # Homepage / listings grid
      login/                # Twitter OAuth + passkey setup
      listing/[id]/         # Listing detail + deposit
      escrow/[id]/          # Escrow detail + actions + chat
      escrows/              # My escrows list
      account/              # Account page
    components/             # Shared components
      escrow-chat.tsx       # In-app messaging
      listing-card.tsx      # Listing grid card
      nav.tsx               # Navigation bar
    lib/
      api.ts                # Supabase client + API helpers
      auth.ts               # Browser auth state (localStorage)
      types.ts              # TypeScript types
  supabase/
    functions/niche-api/    # Edge Function (all backend logic)
      index.ts              # Routes: auth, escrow, wallet, messages
    migrations/             # SQL migrations
  docs/                     # Architecture and deployment docs
```

## Setup

### Prerequisites

- Node.js 18+
- pnpm
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A [Supabase](https://supabase.com) project
- A [Privy](https://privy.io) app (with Twitter login enabled)

### 1. Clone and install

```bash
git clone https://github.com/ClementSutjiatma/niche.git
cd niche/skills/niche

# Install CLI dependencies
npm install

# Install UI dependencies
cd niche-ui
pnpm install
```

### 2. Configure environment

```bash
# Copy the example env file
cp niche-ui/.env.example niche-ui/.env.local
```

Edit `niche-ui/.env.local` with your credentials:

```env
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Set up the database

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

### 4. Configure Supabase secrets

Set these in your Supabase project (Dashboard > Edge Functions > Secrets):

| Secret | Description |
|---|---|
| `PRIVY_APP_ID` | Your Privy app ID |
| `PRIVY_APP_SECRET` | Your Privy app secret |
| `ESCROW_WALLET_ID` | Privy wallet ID for the escrow treasury |
| `ESCROW_WALLET_ADDRESS` | Ethereum address of the escrow wallet |
| `RESEND_API_KEY` | (Optional) Resend API key for email notifications |

### 5. Deploy the Edge Function

```bash
supabase functions deploy niche-api --no-verify-jwt
```

### 6. Run locally

```bash
cd niche-ui
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### 7. Deploy to Vercel

```bash
cd niche-ui
vercel --prod
```

Set the same `NEXT_PUBLIC_*` environment variables in your Vercel project settings.

## Escrow State Machine

```
deposited ──→ accepted ──→ buyer_confirmed ──→ released
    │              │              │
    │              │              └──→ disputed
    │              └──→ disputed
    │              └──→ cancelled (buyer)
    └──→ rejected (seller refunds)
    └──→ expired (48h auto-refund)
    └──→ cancelled (buyer)
```

| Transition | Who | What Happens |
|---|---|---|
| deposited → accepted | Seller | Seller accepts deposit, chat opens |
| deposited → rejected | Seller | Deposit refunded to buyer |
| deposited → expired | System | 48h timeout, auto-refund |
| deposited → cancelled | Buyer | Buyer cancels, deposit refunded |
| accepted → buyer_confirmed | Buyer | Buyer pays remaining + confirms |
| accepted → cancelled | Buyer | Buyer cancels, deposit refunded |
| buyer_confirmed → released | Seller | Seller confirms, funds released |
| Any active → disputed | Either | Funds frozen for manual resolution |

## CLI Usage

```bash
# Configure the CLI
niche config --supabase-url https://your-project.supabase.co --anon-key your_key

# Login (opens browser for Twitter auth)
niche login

# List active listings
niche list

# View a listing
niche show <listing-id>

# Create a listing
niche create --name "Charizard Base Set" --price 500 --deposit 100 --category Pokemon

# Place a deposit
niche deposit <listing-id>
```

## Tech Stack

- **Next.js 15** with App Router and React 19
- **Tailwind CSS 4** for styling
- **Supabase** for database and edge functions
- **Privy** for Twitter OAuth and server-side wallets
- **WebAuthn** (passkeys) for transaction authorization via Touch ID / Face ID
- **viem** for ERC-20 transaction encoding
- **Base Sepolia** testnet for USDC transfers

## License

MIT
