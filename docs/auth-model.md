# Niche Auth Model

Session-based authentication for the niche marketplace.

## Overview

All wallets are owned by `user_id` (Privy server-side signing). The Edge
Function enforces **one wallet per Privy user** by listing existing wallets
before creating, preventing orphaned wallets and stranded funds.

## Login Flow

```
User opens niche-ui /login (or `niche login` opens browser)
  |
  v
[1] Email OTP (via Privy JS SDK)
  |  - User enters email in hosted UI
  |  - 6-digit code sent, user verifies
  |  - Privy returns privyUserId
  |
  v
[2] Wallet Lookup (POST /auth/lookup)
  |  - Edge Function checks Supabase `users` table by email
  |  - If not found: falls back to privy.wallets().list({ user_id })
  |  - If wallet found anywhere: return it (skip passkey step)
  |  - If wallet found in Privy but not Supabase: backfill user row
  |
  v
[3] If no wallet exists → Passkey Registration + Wallet Creation
  |  - User registers passkey (Touch ID / Face ID)
  |  - POST /auth/wallet { privyUserId, email, passkey }
  |  - Edge Function: wallets().list({ user_id }) — check AGAIN
  |  - If still no wallet: wallets().create() with idempotency key
  |  - Upsert Supabase user row with wallet address
  |
  v
[4] Auth state saved to localStorage (browser) / ~/.niche/auth.json (CLI)
```

## Wallet Deduplication (One Wallet Per Email)

Three layers prevent duplicate wallet creation:

### Layer 1: Edge Function `/auth/lookup` (Privy fallback)

When a user verifies their email, the client calls `/auth/lookup`. The Edge
Function checks two sources:

1. **Supabase `users` table** — fast local lookup by `channel_id` (email)
2. **Privy `wallets().list({ user_id })`** — authoritative fallback if not in Supabase

If Privy has a wallet but Supabase doesn't, the Edge Function backfills the
Supabase row and returns `{ found: true, wallet_address }`. The client skips
the passkey step entirely and reuses the existing wallet.

### Layer 2: Edge Function `/auth/wallet` (list-before-create)

Even if lookup was skipped or returned "not found", the wallet creation
endpoint guards against duplicates:

```
POST /auth/wallet { privyUserId, email, passkey }
  |
  v
privy.wallets().list({ user_id, chain_type: 'ethereum' })
  |
  ├── Wallet found → return existing wallet (no creation)
  |
  └── No wallet → privy.wallets().create({
        chain_type: 'ethereum',
        owner: { user_id: privyUserId },
        'privy-idempotency-key': `wallet-create-${privyUserId}-ethereum`
      })
```

The **deterministic idempotency key** (`wallet-create-{privyUserId}-ethereum`)
ensures that even if the create request is retried within Privy's 24-hour
idempotency window, the same wallet is returned.

### Layer 3: Client-side error handling

The login page (`niche-ui/app/login/login-form.tsx`) does **not** swallow `/auth/lookup`
errors. If the lookup fails due to a network error, the user sees an error
message and must retry — the flow does **not** fall through to wallet creation.

```
authVerifyCode()
  |
  ├── /auth/lookup succeeds, wallet found → reuse wallet, done
  |
  ├── /auth/lookup succeeds, not found → proceed to passkey step
  |
  └── /auth/lookup fails (network error) → show error, STOP
        (do NOT proceed to passkey/wallet creation)
```

### Token Expiry

When a session token expires, `isAuthenticated()` returns `false` but
**does NOT delete auth.json**. The identity data (email, wallet, privyUserId)
survives, so the wallet lookup works on the next `niche login`.

Only `niche logout` clears auth.json / localStorage.

## Session Management

### Browser (localStorage)

```json
{
  "privyUserId": "did:privy:...",
  "email": "user@example.com",
  "wallet": "0x...",
  "walletId": "wallet-id",
  "passkey": {
    "publicKey": "base64...",
    "credentialId": "base64..."
  }
}
```

### CLI (~/.niche/auth.json)

```json
{
  "privyUserId": "did:privy:...",
  "provider": "email",
  "email": "user@example.com",
  "wallet": {
    "id": "wallet-id",
    "address": "0x..."
  },
  "authToken": "...",
  "expiresAt": "2026-03-08T...",
  "walletOwnershipType": "user_id"
}
```

Sessions expire after 30 days.

## Command Protection Matrix

| Command | `requireAuth` |
|---------|:---:|
| `search`, `show`, `escrow`, `balance`, `check-matches`, `whoami` | No |
| `post`, `list`, `cancel`, `watch`, `watches`, `unwatch` | Yes |
| `interest` (deposit escrow) | Yes |
| `confirm` (release escrow) | Yes |
| `dispute` (freeze escrow) | Yes |

Simulated users (`--simulate <name>`) bypass auth.

## Auth Guards

### `requireAuth(user)` (`lib/auth.js`)

Centralized check replacing all copy-pasted auth blocks.

```
requireAuth(user)
  |-- user.simulated? -> true (bypass)
  |-- !user? -> "Not set up yet. Run niche login"
  |-- !isAuthenticated()? -> "Authentication required"
  |-- else -> true
```

## Wallet Ownership

All wallets use `owner: { user_id }` (Privy server-side signing).

- Transactions signed server-side by Privy using the app secret
- Gas sponsored (`sponsor: true`) — users don't need ETH
- `wallets().list({ user_id })` always finds the wallet on re-login
- No wallet proliferation risk — list-before-create enforced server-side

## Security Properties

- **No passwords stored**: Auth via email OTP, sessions via tokens
- **Server-side signing**: Privy signs transactions using app secret + user_id ownership
- **Gas sponsorship**: Users only need USD, no ETH
- **Token expiry preservation**: Expired tokens don't destroy identity data
- **One wallet per user**: Enforced at Edge Function level via list-before-create + idempotency key
- **Client-side safety net**: Lookup errors surface to user instead of silently creating new wallets

## File Reference

| File | Role |
|------|------|
| `lib/auth.js` | Auth state, `requireAuth()`, `isAuthenticated()` |
| `niche-ui/app/login/login-form.tsx` | Login page — email OTP, passkey, wallet (React client component) |
| `niche-ui/lib/auth.ts` | Browser auth helpers — `getAuth()`, `saveAuth()`, `clearAuth()` |
| `supabase/functions/niche-api/index.ts` | Edge Function: `/auth/lookup`, `/auth/wallet` |
| `cli.js` | Command handlers with auth guards |
| `~/.niche/auth.json` | CLI persisted auth state |
| `localStorage:niche_auth` | Browser persisted auth state |
