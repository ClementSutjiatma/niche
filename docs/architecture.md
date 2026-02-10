# Niche — System Architecture

A peer-to-peer Mac Mini marketplace with on-chain USDC escrow on Base. Buyers and sellers coordinate in-person meetups with funds held in escrow until both parties confirm the trade.

---

## 1. System Overview

```mermaid
graph TD
    subgraph Clients
        UI["niche-ui\nNext.js 15 · React 19\nVercel"]
        CLI["CLI · cli.js\nNode.js"]
        Agent["AI Agent\ncurl · open"]
    end

    subgraph Supabase["Supabase Platform"]
        EF["niche-api\nEdge Function · Deno"]
        PG["PostgreSQL\nusers · listings\nescrows · messages · watches"]
        REST["PostgREST\nAuto-generated read API"]
    end

    subgraph External["External Services"]
        Privy["Privy\nOAuth · Server Wallets · Passkeys"]
        Base["Base Sepolia\nUSDC Contract"]
        Resend["Resend\nEmail Notifications"]
        Twilio["Twilio\nSMS · Meetup Agent"]
    end

    UI -->|"Mutations"| EF
    UI -->|"Direct reads"| REST
    CLI -->|"HTTP"| EF
    CLI -->|"Direct reads"| REST
    Agent -->|"curl"| EF
    Agent -->|"curl"| REST

    EF -->|"SQL"| PG
    EF -->|"Wallet ops"| Privy
    EF -->|"USDC transfers"| Base
    EF -->|"Emails"| Resend
    EF -->|"SMS coordination"| Twilio
    REST -->|"Auto-API"| PG
```

| Component | Technology | Responsibility | Deployed To |
|-----------|-----------|----------------|-------------|
| **niche-ui** | Next.js 15, React 19, Tailwind 4 | Web UI for humans | Vercel |
| **CLI** | Node.js 18+ | Terminal client for agents + power users | npm (local) |
| **niche-api** | Deno (Supabase Edge Function) | All backend logic: auth, escrow, wallets, messages | Supabase |
| **PostgreSQL** | Supabase Postgres | Persistent storage | Supabase |
| **PostgREST** | Auto-generated from schema | Read-only API for listings, escrows | Supabase |
| **Privy** | SaaS | Twitter OAuth, server-side wallets, passkey verification | privy.io |
| **Base Sepolia** | EVM L2 testnet | USDC escrow transfers | Base network |
| **Resend** | SaaS | Email notifications on escrow completion | resend.com |
| **Twilio** | SaaS (proposed) | SMS-based meetup coordination agent | twilio.com |

---

## 2. User Flow → Technology Flow

Each subsection maps a user action to the exact technical sequence that executes it.

### 2a. Authentication (Twitter Login)

```mermaid
sequenceDiagram
    actor User
    participant UI as niche-ui
    participant Privy as Privy SDK
    participant Twitter as Twitter/X OAuth
    participant EF as niche-api
    participant DB as PostgreSQL

    User->>UI: Click "Continue with Twitter/X"
    UI->>Privy: login()
    Privy->>Twitter: OAuth redirect
    Twitter-->>Privy: Access token + profile
    Privy-->>UI: Authenticated user object

    UI->>EF: POST /auth/lookup
    Note right of EF: {privyUserId, twitterUsername, twitterUserId}
    EF->>DB: SELECT FROM users WHERE channel_id = twitterUserId

    alt User exists with wallet
        DB-->>EF: User row
        EF-->>UI: {found: true, wallet, userId}
        UI->>UI: saveAuth() → localStorage
    else New user
        EF-->>UI: {found: false}
        UI->>UI: Redirect → /login/setup-passkey
    end
```

### 2b. Passkey Setup + Wallet Creation

```mermaid
sequenceDiagram
    actor User
    participant Browser as WebAuthn API
    participant UI as niche-ui
    participant EF as niche-api
    participant Privy as Privy Wallets
    participant DB as PostgreSQL

    UI->>EF: POST /auth/challenge
    EF-->>UI: {challenge: base64}

    UI->>Browser: navigator.credentials.create({publicKey})
    Browser->>User: Touch ID / Face ID prompt
    User-->>Browser: Biometric OK
    Browser-->>UI: PublicKeyCredential

    UI->>EF: POST /auth/wallet
    Note right of EF: {privyUserId, passkey, twitterUsername}

    EF->>Privy: wallets().create({chain_type: "ethereum"})
    Privy-->>EF: {address: "0x...", id: "wallet_..."}

    EF->>DB: INSERT user (channel_id, wallet_address)
    EF->>DB: UPDATE user SET passkey_public_key, passkey_credential_id
    EF-->>UI: {wallet, walletId, userId}
    UI->>UI: saveAuth() → localStorage
```

### 2c. Deposit (Buyer Claims a Listing)

```mermaid
sequenceDiagram
    actor Buyer
    participant UI as niche-ui
    participant WebAuthn as WebAuthn API
    participant Privy as Privy SDK
    participant Base as Base Sepolia
    participant EF as niche-api
    participant DB as PostgreSQL

    Buyer->>UI: Click "Place Deposit" on listing

    Note over UI,WebAuthn: Passkey challenge = SHA-256(listingId:wallet:amount:timestamp)
    UI->>WebAuthn: navigator.credentials.get({challenge})
    WebAuthn->>Buyer: Touch ID prompt
    Buyer-->>WebAuthn: Biometric OK
    WebAuthn-->>UI: Assertion (signature + authenticatorData)

    UI->>Privy: sendTransaction({to: USDC, data: transfer(escrowWallet, depositAmount)})
    Privy->>Base: ERC-20 transfer (gas sponsored)
    Base-->>Privy: txHash
    Privy-->>UI: {hash: "0x..."}

    UI->>EF: POST /escrow/deposit
    Note right of EF: {listingId, buyerWallet, txHash, passkey assertion}
    EF->>EF: Verify passkey assertion
    EF->>DB: Verify listing is active + not own listing
    EF->>DB: INSERT escrow (status: deposited, expires_at: now + 48h)
    EF->>DB: UPDATE listing SET status = 'pending'
    EF-->>UI: {escrowId, txHash}

    UI->>UI: Redirect → /escrow/{id}
```

### 2d. Escrow Lifecycle (Accept → Release)

```mermaid
sequenceDiagram
    actor Seller
    actor Buyer
    participant EF as niche-api
    participant DB as PostgreSQL
    participant Privy as Privy Wallets
    participant Base as Base Sepolia
    participant Email as Resend

    Note over Seller,Buyer: ── Status: deposited ──
    Seller->>EF: POST /escrow/accept {escrowId, wallet}
    EF->>DB: UPDATE escrow SET status = 'accepted', accepted_at = now()

    Note over Seller,Buyer: ── Status: accepted · Chat opens ──
    Buyer->>EF: GET /escrow/:id/messages
    Seller->>EF: POST /escrow/:id/messages
    Note over Seller,Buyer: Coordinate meetup via chat + SMS agent

    Note over Seller,Buyer: ── In-person meetup occurs ──
    Buyer->>EF: POST /escrow/confirm
    Note right of EF: {escrowId, wallet, remainingPaymentTxHash, passkey}
    EF->>DB: UPDATE escrow SET status = 'buyer_confirmed'

    Note over Seller,Buyer: ── Status: buyer_confirmed ──
    Seller->>EF: POST /escrow/confirm {escrowId, wallet}
    EF->>Privy: sendTransaction(ESCROW_WALLET → seller, totalPrice)
    Privy->>Base: USDC transfer to seller
    Base-->>Privy: txHash
    EF->>DB: UPDATE escrow SET status = 'released', release_tx_hash = ...
    EF->>DB: UPDATE listing SET status = 'sold'
    EF->>Email: Notify buyer + seller

    Note over Seller,Buyer: ── Status: released · Complete ──
```

### 2e. Browse & Search

```mermaid
sequenceDiagram
    actor User
    participant UI as niche-ui
    participant Parser as parseNaturalLanguage()
    participant REST as Supabase PostgREST
    participant DB as PostgreSQL

    User->>UI: Type "M4 Pro under $1500"
    UI->>Parser: Parse natural language query
    Parser-->>UI: {chip: "M4 Pro", max_price: 1500}

    UI->>REST: GET /rest/v1/listings?chip=eq.M4 Pro&price=lte.1500&status=eq.active
    REST->>DB: SELECT * FROM listings WHERE chip='M4 Pro' AND price <= 1500
    DB-->>REST: Matching rows
    REST-->>UI: JSON array

    UI->>UI: Render listing grid with ListingCard components
```

---

## 3. Data Flow

### 3a. Deposit Data Flow

Shows how data moves through each layer when a buyer places a deposit.

```mermaid
graph LR
    subgraph "Browser"
        A["localStorage\n(auth state)"] --> B["WebAuthn\nchallenge + sign"]
        B --> C["Privy SDK\nsendTransaction()"]
    end

    subgraph "Blockchain"
        C --> D["USDC.transfer()\nbuyer → escrow wallet"]
        D --> E["txHash confirmed"]
    end

    subgraph "Edge Function"
        E --> F["POST /escrow/deposit"]
        F --> G["Verify passkey\nassertion"]
        G --> H["Validate listing\n(active, not own)"]
    end

    subgraph "Database"
        H --> I["INSERT escrow\nstatus: deposited\nexpires_at: +48h"]
        I --> J["UPDATE listing\nstatus: pending"]
    end
```

### 3b. Fund Release Data Flow

Shows how data moves when a seller confirms the handoff and funds are released.

```mermaid
graph LR
    subgraph "Seller Action"
        A["POST /escrow/confirm"] --> B["Verify seller\nrole + status"]
    end

    subgraph "On-Chain Release"
        B --> C["encodeFunctionData()\nUSDC.transfer(seller, total)"]
        C --> D["Privy sendTransaction()\nfrom escrow wallet"]
        D --> E["Base Sepolia\nUSDC confirmed"]
    end

    subgraph "Database"
        E --> F["escrow.status\n= released"]
        F --> G["listing.status\n= sold"]
    end

    subgraph "Notifications"
        G --> H["Email buyer\nvia Resend"]
        G --> I["Email seller\nvia Resend"]
    end
```

---

## 4. Escrow State Machine

```mermaid
stateDiagram-v2
    [*] --> deposited : Buyer deposits USDC

    deposited --> accepted : Seller accepts
    deposited --> rejected : Seller rejects → refund
    deposited --> cancelled : Buyer cancels → refund
    deposited --> expired : 48h timeout → auto-refund
    deposited --> disputed : Either party disputes

    accepted --> buyer_confirmed : Buyer confirms + pays remaining
    accepted --> cancelled : Buyer cancels → refund
    accepted --> disputed : Either party disputes

    buyer_confirmed --> released : Seller confirms → funds released
    buyer_confirmed --> disputed : Either party disputes

    released --> [*]
    rejected --> [*]
    cancelled --> [*]
    expired --> [*]
    disputed --> [*]
```

| State | Who Acts Next | What Happens | On-Chain Effect |
|-------|--------------|--------------|-----------------|
| **deposited** | Seller (48h window) | Accept, reject, or let expire | Deposit USDC held in escrow wallet |
| **accepted** | Buyer | Chat opens, arrange meetup | No change |
| **buyer_confirmed** | Seller | Buyer inspected item + paid remaining | Remaining USDC in escrow wallet |
| **released** | — | Transaction complete | Total USDC transferred to seller |
| **rejected** | — | Listing reactivated | Deposit refunded to buyer |
| **cancelled** | — | Listing reactivated | Deposit refunded to buyer |
| **expired** | — | Auto after 48h, listing reactivated | Deposit refunded to buyer |
| **disputed** | Admin | Manual resolution required | Funds frozen in escrow wallet |

---

## 5. Secure Meetup Coordination

> **Status: Proposed Design**
>
> This section describes a planned feature that is not yet implemented. The goal is to make meetup coordination simple, private, and safe.

### The Problem

After escrow reaches `accepted`, buyer and seller need to arrange an in-person meetup. Today this happens via freeform chat — which means:

- **Privacy risk**: Phone numbers and addresses end up in the app database
- **Friction**: Back-and-forth messaging to find a time and place
- **No safety guardrails**: No suggestion of public venues, no safety tips

### The Solution: Agent-Mediated SMS Coordination

An AI agent handles the logistics via SMS. No location data or phone numbers are ever stored in the app database.

```
┌──────────────────────────────────────────────────────────┐
│                    DESIGN PRINCIPLES                      │
│                                                          │
│  1. No location data in the app database — ever          │
│  2. Phone numbers only exist in Twilio (72h auto-delete) │
│  3. Agent suggests only safe public venues               │
│  4. Both parties must confirm before meetup is set        │
│  5. Either party can cancel/reschedule via SMS            │
└──────────────────────────────────────────────────────────┘
```

### Trigger

The meetup agent activates when escrow status transitions to **`accepted`**. At this point the seller has committed and both parties need to coordinate.

### Phone Number Collection

When escrow transitions to `accepted`, the escrow UI shows a **one-time phone input field**:

> "Ready to coordinate your meetup? Enter your phone number below. Our meetup agent will handle scheduling via SMS. Your number is only shared with the coordination agent — never stored in the app."

The phone number is:
1. Submitted directly from the UI to the meetup agent service (Twilio)
2. **Never written to the messages table or any app database table**
3. Stored only in Twilio's context with a 72-hour auto-deletion policy

### Agent Coordination Flow

```mermaid
sequenceDiagram
    actor Buyer
    actor Seller
    participant UI as Escrow UI
    participant EF as niche-api
    participant Agent as Meetup Agent
    participant SMS as Twilio SMS

    Note over EF: Escrow status → accepted
    EF-->>UI: Show phone number input

    Buyer->>UI: Enter phone number
    UI->>Agent: Register buyer phone (encrypted, bypasses app DB)

    Seller->>UI: Enter phone number
    UI->>Agent: Register seller phone (encrypted, bypasses app DB)

    Note over Agent: Both phones registered — begin coordination

    Agent->>SMS: Text buyer
    SMS->>Buyer: "Hi! I'm coordinating your Mac Mini meetup. What area and times work for you?"
    Buyer-->>SMS: "Downtown SF, weekday evenings"
    SMS->>Agent: Forward reply

    Agent->>SMS: Text seller
    SMS->>Seller: "Buyer is available downtown, weekday evenings. Does that work? I'd suggest Apple Store Union Square or a nearby coffee shop."
    Seller-->>SMS: "Apple Store Thursday 6pm works"
    SMS->>Agent: Forward reply

    Agent->>SMS: Text buyer
    SMS->>Buyer: "Seller suggests Apple Store Union Square, Thursday 6pm. Confirm? (Reply YES or suggest alternative)"
    Buyer-->>SMS: "YES"
    SMS->>Agent: Forward confirmation

    Agent->>SMS: Text seller
    SMS->>Seller: "Confirmed! Apple Store Union Square, Thursday 6pm. Safety tips: meet in the store, inspect the item before confirming in the app."

    Agent->>EF: POST /escrow/:id/messages (system message)
    EF-->>UI: "✅ Meetup confirmed via agent — Thursday 6pm"

    Note over Agent: Auto-delete phone numbers after 72h
```

### Privacy Boundary

```mermaid
graph TB
    subgraph AppDomain["App Domain — Supabase"]
        DB["PostgreSQL"]
        EF["Edge Function"]
        Chat["Messages Table"]

        DB -.- NoPhone["✗ No phone numbers"]
        DB -.- NoLocation["✗ No addresses or GPS"]
        Chat -.- OnlyConfirm["✓ Only confirmation summary\n'Meetup confirmed — Thursday 6pm'"]
    end

    subgraph AgentDomain["Agent Domain — Twilio"]
        TW["Twilio SMS Service"]
        AI["AI Coordination Agent"]
        Ephemeral["Ephemeral Phone Store\n72h auto-delete"]
    end

    EF -->|"Escrow ID only\n(no PII)"| AI
    UI2["Escrow UI"] -->|"Phone number\n(one-time, encrypted)"| AI
    AI -->|"SMS via"| TW
    AI -->|"Confirmation summary\n(no address)"| EF
    TW -->|"Stores in"| Ephemeral
```

### What Lives Where

| Data | App Database | Twilio/Agent | Blockchain |
|------|-------------|-------------|------------|
| Phone numbers | ✗ Never | ✓ 72h then deleted | ✗ Never |
| Meeting location | ✗ Never | ✓ In SMS thread only | ✗ Never |
| Meeting time | ✗ Never | ✓ In SMS thread only | ✗ Never |
| Confirmation status | ✓ System message in chat | ✓ In agent context | ✗ N/A |
| Wallet addresses | ✓ Users table | ✗ N/A | ✓ On-chain |
| USDC amounts | ✓ Escrows table | ✗ N/A | ✓ On-chain |

### Agent Safety Features

1. **Public venues only** — Agent suggests Apple Stores, coffee shops, public libraries, police station lobbies
2. **Unsafe location warning** — If either party suggests a residential address or isolated area, the agent flags it and suggests alternatives
3. **Safety tips SMS** — Both parties receive a safety checklist before the meetup:
   - Meet in a well-lit public place
   - Inspect the item before confirming in the app
   - Bring a friend if possible
   - Don't share your wallet seed phrase
4. **Reschedule/cancel** — Either party can text the agent to reschedule or cancel at any time
5. **Auto-expiry** — Agent conversation expires 72 hours after confirmation. If neither party shares a phone number within 24 hours of `accepted`, the system falls back to in-app chat only

---

## 6. Security Model

### Authentication Layers

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Identity** | Privy + Twitter OAuth | Social login, user identification |
| **Authorization** | WebAuthn passkeys | Transaction signing via Touch ID / Face ID |
| **Wallet** | Privy server-side wallets | One-per-user, non-custodial |
| **API access** | Supabase anon key | Public read access to listings |
| **Backend access** | Supabase service role key | Full DB access in Edge Function |

### Passkey Challenge-Response

All financial transactions (deposit, remaining payment) require a passkey assertion:

1. **Client** generates challenge: `SHA-256(listingId + ":" + wallet + ":" + amount + ":" + timestamp)`
2. **WebAuthn** signs the challenge with the device's biometric sensor (Touch ID / Face ID)
3. **Server** verifies:
   - `authenticatorData` structure is valid
   - `clientDataJSON.type === "webauthn.get"`
   - `credentialId` matches the user's registered passkey
   - Challenge parameters match the transaction parameters

### Access Control Matrix

| Action | Anonymous | Authenticated Buyer | Authenticated Seller | Either Party |
|--------|-----------|-------------------|---------------------|-------------|
| Browse listings | ✓ | ✓ | ✓ | — |
| View listing detail | ✓ | ✓ | ✓ | — |
| Place deposit | — | ✓ (passkey required) | — | — |
| Accept deposit | — | — | ✓ | — |
| Reject deposit | — | — | ✓ | — |
| Send message | — | ✓ | ✓ | — |
| Read messages | — | ✓ | ✓ | — |
| Confirm + pay remaining | — | ✓ (passkey required) | — | — |
| Confirm handoff (release) | — | — | ✓ | — |
| Cancel escrow | — | ✓ | — | — |
| File dispute | — | — | — | ✓ |

### On-Chain Security

- **Escrow wallet**: App-owned Privy server wallet — only the Edge Function can sign transactions from it
- **USDC contract**: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` on Base Sepolia
- **Chain ID**: 84532
- **Gas sponsorship**: Privy sponsors gas fees — users never need ETH
- **Precision**: USDC uses 6 decimal places (amounts multiplied by 10^6)
- **Idempotency**: Wallet creation uses idempotency keys to prevent duplicates

---

## 7. Deployment Architecture

```mermaid
graph TB
    subgraph Vercel["Vercel"]
        UI["niche-ui\nNext.js 15\nSSR + Static"]
    end

    subgraph Supabase["Supabase"]
        EF["niche-api\nDeno Edge Function"]
        PG["PostgreSQL"]
        REST["PostgREST"]
        Vault["Vault\n(encrypted secrets)"]
    end

    subgraph PrivyCloud["Privy"]
        Auth["OAuth + Passkeys"]
        Wallets["Server Wallets"]
        Gas["Gas Sponsorship"]
    end

    subgraph BaseSepolia["Base Sepolia"]
        USDC["USDC Contract"]
    end

    subgraph Comms["Communications"]
        ResendSvc["Resend · Email"]
        TwilioSvc["Twilio · SMS"]
    end

    UI --> EF
    UI --> REST
    EF --> PG
    EF --> Vault
    EF --> Auth
    EF --> Wallets
    Wallets --> USDC
    Gas --> USDC
    EF --> ResendSvc
    EF --> TwilioSvc
```

### Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Vercel | Privy app identifier (client-side) |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Supabase project URL (client-side) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Supabase anonymous key (client-side) |
| `PRIVY_APP_ID` | Supabase Vault | Privy app identifier (server-side) |
| `PRIVY_APP_SECRET` | Supabase Vault | Privy authentication secret |
| `ESCROW_WALLET_ID` | Supabase Vault | Privy wallet ID for the treasury |
| `ESCROW_WALLET_ADDRESS` | Supabase Vault | Ethereum address of escrow wallet |
| `RESEND_API_KEY` | Supabase Vault | Email notification service key |

### Client Comparison

| Capability | Web UI | CLI | AI Agent |
|-----------|--------|-----|----------|
| Browse listings | ✓ Grid view | ✓ `niche search` | ✓ curl PostgREST |
| Login | ✓ Twitter OAuth in-app | ✓ Opens browser | ✓ Opens browser |
| Deposit | ✓ Passkey in-app | ✓ Opens browser | ✓ Opens browser |
| Chat | ✓ In-app messaging | — | — |
| Confirm/Cancel | ✓ In-app | ✓ `niche confirm` | ✓ curl Edge Function |
| Watch alerts | — | ✓ `niche watch` | ✓ cron-compatible |

---

## 8. Database Schema

```mermaid
erDiagram
    users {
        uuid id PK
        text channel_id
        text channel_type
        text wallet_address
        text display_name
        text twitter_username
        text twitter_user_id
        text passkey_public_key
        text passkey_credential_id
        timestamptz created_at
    }

    listings {
        uuid id PK
        uuid user_id FK
        text item_name
        numeric price
        numeric min_deposit
        text item_description
        text category
        text status
        text chip
        integer ram
        integer storage
        text condition
        integer year
        boolean has_warranty
        boolean includes_box
        text includes_accessories
        timestamptz created_at
    }

    escrows {
        uuid id PK
        uuid listing_id FK
        uuid buyer_id FK
        uuid seller_id FK
        numeric deposit_amount
        numeric total_price
        numeric remaining_amount
        text currency
        text escrow_service
        text status
        boolean buyer_confirmed
        boolean seller_confirmed
        text deposit_tx_hash
        text remaining_payment_tx_hash
        text release_tx_hash
        timestamptz accepted_at
        timestamptz expires_at
        timestamptz confirmed_at
        timestamptz created_at
    }

    messages {
        uuid id PK
        uuid escrow_id FK
        uuid sender_id FK
        text body
        timestamptz created_at
    }

    watches {
        uuid id PK
        uuid user_id FK
        text[] categories
        numeric max_price
        timestamptz created_at
    }

    users ||--o{ listings : "sells"
    users ||--o{ escrows : "buys as buyer_id"
    users ||--o{ escrows : "sells as seller_id"
    users ||--o{ messages : "sends"
    users ||--o{ watches : "watches"
    listings ||--o{ escrows : "claimed via"
    escrows ||--o{ messages : "contains"
```

### Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_listings_chip` | listings | chip | Filter by Apple Silicon chip |
| `idx_listings_ram` | listings | ram | Filter by RAM |
| `idx_listings_condition` | listings | condition | Filter by condition |
| `idx_messages_escrow` | messages | escrow_id, created_at | Fast message retrieval per escrow |
| `idx_escrows_remaining_tx` | escrows | remaining_payment_tx_hash | Transaction lookup |
