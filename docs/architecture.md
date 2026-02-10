# Niche — System Architecture

A peer-to-peer Mac Mini marketplace with on-chain USDC escrow on Base. Buyers and sellers coordinate in-person meetups with funds held in escrow until both parties confirm the trade.

---

## 1. System Overview

![System Overview](https://mermaid.ink/img/Z3JhcGggVEQKICAgIHN1YmdyYXBoIENsaWVudHMKICAgICAgICBVSVsibmljaGUtdWk8YnI+TmV4dC5qcyAxNSDCtyBSZWFjdCAxOTxicj5WZXJjZWwiXQogICAgICAgIENMSVsiQ0xJIMK3IGNsaS5qczxicj5Ob2RlLmpzIl0KICAgICAgICBBZ2VudFsiQUkgQWdlbnQ8YnI+Y3VybCDCtyBvcGVuIl0KICAgIGVuZAoKICAgIHN1YmdyYXBoIFN1cGFiYXNlWyJTdXBhYmFzZSBQbGF0Zm9ybSJdCiAgICAgICAgRUZbIm5pY2hlLWFwaTxicj5FZGdlIEZ1bmN0aW9uIMK3IERlbm8iXQogICAgICAgIFBHWyJQb3N0Z3JlU1FMPGJyPnVzZXJzIMK3IGxpc3RpbmdzPGJyPmVzY3Jvd3MgwrcgbWVzc2FnZXMgwrcgd2F0Y2hlcyJdCiAgICAgICAgUkVTVFsiUG9zdGdSRVNUPGJyPkF1dG8tZ2VuZXJhdGVkIHJlYWQgQVBJIl0KICAgIGVuZAoKICAgIHN1YmdyYXBoIEV4dGVybmFsWyJFeHRlcm5hbCBTZXJ2aWNlcyJdCiAgICAgICAgUHJpdnlbIlByaXZ5PGJyPk9BdXRoIMK3IFNlcnZlciBXYWxsZXRzIMK3IFBhc3NrZXlzIl0KICAgICAgICBCYXNlWyJCYXNlIFNlcG9saWE8YnI+VVNEQyBDb250cmFjdCJdCiAgICAgICAgUmVzZW5kWyJSZXNlbmQ8YnI+RW1haWwgTm90aWZpY2F0aW9ucyJdCiAgICAgICAgVHdpbGlvWyJUd2lsaW88YnI+U01TIMK3IE1lZXR1cCBBZ2VudCJdCiAgICBlbmQKCiAgICBVSSAtLT58Ik11dGF0aW9ucyJ8IEVGCiAgICBVSSAtLT58IkRpcmVjdCByZWFkcyJ8IFJFU1QKICAgIENMSSAtLT58IkhUVFAifCBFRgogICAgQ0xJIC0tPnwiRGlyZWN0IHJlYWRzInwgUkVTVAogICAgQWdlbnQgLS0+fCJjdXJsInwgRUYKICAgIEFnZW50IC0tPnwiY3VybCJ8IFJFU1QKCiAgICBFRiAtLT58IlNRTCJ8IFBHCiAgICBFRiAtLT58IldhbGxldCBvcHMifCBQcml2eQogICAgRUYgLS0+fCJVU0RDIHRyYW5zZmVycyJ8IEJhc2UKICAgIEVGIC0tPnwiRW1haWxzInwgUmVzZW5kCiAgICBFRiAtLT58IlNNUyBjb29yZGluYXRpb24ifCBUd2lsaW8KICAgIFJFU1QgLS0+fCJBdXRvLUFQSSJ8IFBH)

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

![Authentication Flow](https://mermaid.ink/img/c2VxdWVuY2VEaWFncmFtCiAgICBhY3RvciBVc2VyCiAgICBwYXJ0aWNpcGFudCBVSSBhcyBuaWNoZS11aQogICAgcGFydGljaXBhbnQgUHJpdnkgYXMgUHJpdnkgU0RLCiAgICBwYXJ0aWNpcGFudCBUd2l0dGVyIGFzIFR3aXR0ZXIvWCBPQXV0aAogICAgcGFydGljaXBhbnQgRUYgYXMgbmljaGUtYXBpCiAgICBwYXJ0aWNpcGFudCBEQiBhcyBQb3N0Z3JlU1FMCgogICAgVXNlci0-PlVJOiBDbGljayAiQ29udGludWUgd2l0aCBUd2l0dGVyL1giCiAgICBVSS0-PlByaXZ5OiBsb2dpbigpCiAgICBQcml2eS0-PlR3aXR0ZXI6IE9BdXRoIHJlZGlyZWN0CiAgICBUd2l0dGVyLS0-PlByaXZ5OiBBY2Nlc3MgdG9rZW4gKyBwcm9maWxlCiAgICBQcml2eS0tPj5VSTogQXV0aGVudGljYXRlZCB1c2VyIG9iamVjdAoKICAgIFVJLT4-RUY6IFBPU1QgL2F1dGgvbG9va3VwCiAgICBOb3RlIHJpZ2h0IG9mIEVGOiB7cHJpdnlVc2VySWQsIHR3aXR0ZXJVc2VybmFtZSwgdHdpdHRlclVzZXJJZH0KICAgIEVGLT4-REI6IFNFTEVDVCBGUk9NIHVzZXJzIFdIRVJFIGNoYW5uZWxfaWQgPSB0d2l0dGVyVXNlcklkCgogICAgYWx0IFVzZXIgZXhpc3RzIHdpdGggd2FsbGV0CiAgICAgICAgREItLT4-RUY6IFVzZXIgcm93CiAgICAgICAgRUYtLT4-VUk6IHtmb3VuZDogdHJ1ZSwgd2FsbGV0LCB1c2VySWR9CiAgICAgICAgVUktPj5VSTogc2F2ZUF1dGgoKSAtPiBsb2NhbFN0b3JhZ2UKICAgIGVsc2UgTmV3IHVzZXIKICAgICAgICBFRi0tPj5VSTogeyBmb3VuZDogZmFsc2UgfQogICAgICAgIFVJLT4-VUk6IFJlZGlyZWN0IC0-IC9sb2dpbi9zZXR1cC1wYXNza2V5CiAgICBlbmQ=)

### 2b. Passkey Setup + Wallet Creation

![Passkey Setup Flow](https://mermaid.ink/img/c2VxdWVuY2VEaWFncmFtCiAgICBhY3RvciBVc2VyCiAgICBwYXJ0aWNpcGFudCBCcm93c2VyIGFzIFdlYkF1dGhuIEFQSQogICAgcGFydGljaXBhbnQgVUkgYXMgbmljaGUtdWkKICAgIHBhcnRpY2lwYW50IEVGIGFzIG5pY2hlLWFwaQogICAgcGFydGljaXBhbnQgUHJpdnkgYXMgUHJpdnkgV2FsbGV0cwogICAgcGFydGljaXBhbnQgREIgYXMgUG9zdGdyZVNRTAoKICAgIFVJLT4-RUY6IFBPU1QgL2F1dGgvY2hhbGxlbmdlCiAgICBFRi0tPj5VSTogeyBjaGFsbGVuZ2U6IGJhc2U2NCB9CgogICAgVUktPj5Ccm93c2VyOiBuYXZpZ2F0b3IuY3JlZGVudGlhbHMuY3JlYXRlKHsgcHVibGljS2V5IH0pCiAgICBCcm93c2VyLT4-VXNlcjogVG91Y2ggSUQgLyBGYWNlIElEIHByb21wdAogICAgVXNlci0tPj5Ccm93c2VyOiBCaW9tZXRyaWMgT0sKICAgIEJyb3dzZXItLT4-VUk6IFB1YmxpY0tleUNyZWRlbnRpYWwKCiAgICBVSS0-PkVGOiBQT1NUIC9hdXRoL3dhbGxldAogICAgTm90ZSByaWdodCBvZiBFRjogeyBwcml2eVVzZXJJZCwgcGFzc2tleSwgdHdpdHRlclVzZXJuYW1lIH0KCiAgICBFRi0-PlByaXZ5OiB3YWxsZXRzKCkuY3JlYXRlKHsgY2hhaW5fdHlwZTogZXRoZXJldW0gfSkKICAgIFByaXZ5LS0-PkVGOiB7IGFkZHJlc3M6IDB4Li4uLCBpZDogd2FsbGV0Xy4uLiB9CgogICAgRUYtPj5EQjogSU5TRVJUIHVzZXIgKGNoYW5uZWxfaWQsIHdhbGxldF9hZGRyZXNzKQogICAgRUYtPj5EQjogVVBEQVRFIHVzZXIgU0VUIHBhc3NrZXlfcHVibGljX2tleSwgcGFzc2tleV9jcmVkZW50aWFsX2lkCiAgICBFRi0tPj5VSTogeyB3YWxsZXQsIHdhbGxldElkLCB1c2VySWQgfQogICAgVUktPj5VSTogc2F2ZUF1dGgoKSAtPiBsb2NhbFN0b3JhZ2U=)

### 2c. Deposit (Buyer Claims a Listing)

![Deposit Flow](https://mermaid.ink/img/c2VxdWVuY2VEaWFncmFtCiAgICBhY3RvciBCdXllcgogICAgcGFydGljaXBhbnQgVUkgYXMgbmljaGUtdWkKICAgIHBhcnRpY2lwYW50IFdlYkF1dGhuIGFzIFdlYkF1dGhuIEFQSQogICAgcGFydGljaXBhbnQgUHJpdnkgYXMgUHJpdnkgU0RLCiAgICBwYXJ0aWNpcGFudCBCYXNlIGFzIEJhc2UgU2Vwb2xpYQogICAgcGFydGljaXBhbnQgRUYgYXMgbmljaGUtYXBpCiAgICBwYXJ0aWNpcGFudCBEQiBhcyBQb3N0Z3JlU1FMCgogICAgQnV5ZXItPj5VSTogQ2xpY2sgUGxhY2UgRGVwb3NpdCBvbiBsaXN0aW5nCgogICAgTm90ZSBvdmVyIFVJLFdlYkF1dGhuOiBQYXNza2V5IGNoYWxsZW5nZSA9IFNIQS0yNTYobGlzdGluZ0lkOndhbGxldDphbW91bnQ6dGltZXN0YW1wKQogICAgVUktPj5XZWJBdXRobjogbmF2aWdhdG9yLmNyZWRlbnRpYWxzLmdldCh7IGNoYWxsZW5nZSB9KQogICAgV2ViQXV0aG4tPj5CdXllcjogVG91Y2ggSUQgcHJvbXB0CiAgICBCdXllci0tPj5XZWJBdXRobjogQmlvbWV0cmljIE9LCiAgICBXZWJBdXRobi0tPj5VSTogQXNzZXJ0aW9uIChzaWduYXR1cmUgKyBhdXRoZW50aWNhdG9yRGF0YSkKCiAgICBVSS0-PlByaXZ5OiBzZW5kVHJhbnNhY3Rpb24oeyB0bzogVVNEQywgZGF0YTogdHJhbnNmZXIoZXNjcm93V2FsbGV0LCBkZXBvc2l0QW1vdW50KSB9KQogICAgUHJpdnktPj5CYXNlOiBFUkMtMjAgdHJhbnNmZXIgKGdhcyBzcG9uc29yZWQpCiAgICBCYXNlLS0-PlByaXZ5OiB0eEhhc2gKICAgIFByaXZ5LS0-PlVJOiB7IGhhc2g6IDB4Li4uIH0KCiAgICBVSS0-PkVGOiBQT1NUIC9lc2Nyb3cvZGVwb3NpdAogICAgTm90ZSByaWdodCBvZiBFRjogeyBsaXN0aW5nSWQsIGJ1eWVyV2FsbGV0LCB0eEhhc2gsIHBhc3NrZXkgYXNzZXJ0aW9uIH0KICAgIEVGLT4-RUY6IFZlcmlmeSBwYXNza2V5IGFzc2VydGlvbgogICAgRUYtPj5EQjogVmVyaWZ5IGxpc3RpbmcgaXMgYWN0aXZlICsgbm90IG93biBsaXN0aW5nCiAgICBFRi0-PkRCOiBJTlNFUlQgZXNjcm93IChzdGF0dXM6IGRlcG9zaXRlZCwgZXhwaXJlc19hdDogbm93ICsgNDhoKQogICAgRUYtPj5EQjogVVBEQVRFIGxpc3RpbmcgU0VUIHN0YXR1cyA9IHBlbmRpbmcKICAgIEVGLS0-PlVJOiB7IGVzY3Jvd0lkLCB0eEhhc2ggfQoKICAgIFVJLT4-VUk6IFJlZGlyZWN0IC0-IC9lc2Nyb3cve2lkfQ==)

### 2d. Escrow Lifecycle (Accept → Release)

![Escrow Lifecycle](https://mermaid.ink/img/c2VxdWVuY2VEaWFncmFtCiAgICBhY3RvciBTZWxsZXIKICAgIGFjdG9yIEJ1eWVyCiAgICBwYXJ0aWNpcGFudCBFRiBhcyBuaWNoZS1hcGkKICAgIHBhcnRpY2lwYW50IERCIGFzIFBvc3RncmVTUUwKICAgIHBhcnRpY2lwYW50IFByaXZ5IGFzIFByaXZ5IFdhbGxldHMKICAgIHBhcnRpY2lwYW50IEJhc2UgYXMgQmFzZSBTZXBvbGlhCiAgICBwYXJ0aWNpcGFudCBFbWFpbCBhcyBSZXNlbmQKCiAgICBOb3RlIG92ZXIgU2VsbGVyLEJ1eWVyOiBTdGF0dXM6IGRlcG9zaXRlZAogICAgU2VsbGVyLT4-RUY6IFBPU1QgL2VzY3Jvdy9hY2NlcHQKICAgIEVGLT4-REI6IFVQREFURSBlc2Nyb3cgU0VUIHN0YXR1cyA9IGFjY2VwdGVkCgogICAgTm90ZSBvdmVyIFNlbGxlcixCdXllcjogU3RhdHVzOiBhY2NlcHRlZCAtIENoYXQgb3BlbnMKICAgIEJ1eWVyLT4-RUY6IEdFVCAvZXNjcm93LzppZC9tZXNzYWdlcwogICAgU2VsbGVyLT4-RUY6IFBPU1QgL2VzY3Jvdy86aWQvbWVzc2FnZXMKICAgIE5vdGUgb3ZlciBTZWxsZXIsQnV5ZXI6IENvb3JkaW5hdGUgbWVldHVwIHZpYSBjaGF0ICsgU01TIGFnZW50CgogICAgTm90ZSBvdmVyIFNlbGxlcixCdXllcjogSW4tcGVyc29uIG1lZXR1cCBvY2N1cnMKICAgIEJ1eWVyLT4-RUY6IFBPU1QgL2VzY3Jvdy9jb25maXJtCiAgICBOb3RlIHJpZ2h0IG9mIEVGOiBlc2Nyb3dJZCwgd2FsbGV0LCByZW1haW5pbmdQYXltZW50VHhIYXNoCiAgICBFRi0-PkRCOiBVUERBVEUgZXNjcm93IFNFVCB0YXR1cyA9IGJ1eWVyX2NvbmZpcm1lZAoKICAgIE5vdGUgb3ZlciBTZWxsZXIsQnV5ZXI6IFN0YXR1czogYnV5ZXJfY29uZmlybWVkCiAgICBTZWxsZXItPj5FRjogUE9TVCAvZXNjcm93L2NvbmZpcm0KICAgIEVGLT4-UHJpdnk6IHNlbmRUcmFuc2FjdGlvbihlc2Nyb3dXYWxsZXQgLT4gc2VsbGVyLCB0b3RhbFByaWNlKQogICAgUHJpdnktPj5CYXNlOiBVU0RDIHRyYW5zZmVyIHRvIHNlbGxlcgogICAgQmFzZS0tPj5Qcml2eTogdHhIYXNoCiAgICBFRi0-PkRCOiBVUERBVEUgZXNjcm93IFNFVCB0YXR1cyA9IHJlbGVhc2VkCiAgICBFRi0-PkRCOiBVUERBVEUgbGlzdGluZyBTRVQgc3RhdHVzID0gc29sZAogICAgRUYtPj5FbWFpbDogTm90aWZ5IGJ1eWVyICsgc2VsbGVyCgogICAgTm90ZSBvdmVyIFNlbGxlcixCdXllcjogU3RhdHVzOiByZWxlYXNlZCAtIENvbXBsZXRl)

### 2e. Browse & Search

![Browse and Search Flow](https://mermaid.ink/img/c2VxdWVuY2VEaWFncmFtCiAgICBhY3RvciBVc2VyCiAgICBwYXJ0aWNpcGFudCBVSSBhcyBuaWNoZS11aQogICAgcGFydGljaXBhbnQgUGFyc2VyIGFzIHBhcnNlTmF0dXJhbExhbmd1YWdlKCkKICAgIHBhcnRpY2lwYW50IFJFU1QgYXMgU3VwYWJhc2UgUG9zdGdSRVNUCiAgICBwYXJ0aWNpcGFudCBEQiBhcyBQb3N0Z3JlU1FMCgogICAgVXNlci0-PlVJOiBUeXBlIE00IFBybyB1bmRlciAkMTUwMAogICAgVUktPj5QYXJzZXI6IFBhcnNlIG5hdHVyYWwgbGFuZ3VhZ2UgcXVlcnkKICAgIFBhcnNlci0tPj5VSTogeyBjaGlwOiBNNCBQcm8sIG1heF9wcmljZTogMTUwMCB9CgogICAgVUktPj5SRVNUOiBHRVQgL3Jlc3QvdjEvbGlzdGluZ3M/Y2hpcD1lcS5NNCBQcm8gYW5kIHByaWNlPWx0ZS4xNTAwCiAgICBSRVNULT4-REI6IFNFTEVDVCBGUk9NIGxpc3RpbmdzIFdIRVJFIGNoaXA9TTQgUHJvIEFORCBwcmljZSA8PSAxNTAwCiAgICBEQi0tPj5SRVNUOiBNYXRjaGluZyByb3dzCiAgICBSRVNULS0-PlVJOiBKU09OIGFycmF5CgogICAgVUktPj5VSTogUmVuZGVyIGxpc3RpbmcgZ3JpZCB3aXRoIExpc3RpbmdDYXJkIGNvbXBvbmVudHM=)

---

## 3. Data Flow

### 3a. Deposit Data Flow

Shows how data moves through each layer when a buyer places a deposit.

![Deposit Data Flow](https://mermaid.ink/img/Z3JhcGggTFIKICAgIHN1YmdyYXBoICJCcm93c2VyIgogICAgICAgIEFbImxvY2FsU3RvcmFnZTxicj4oYXV0aCBzdGF0ZSkiXSAtLT4gQlsiV2ViQXV0aG48YnI+Y2hhbGxlbmdlICsgc2lnbiJdCiAgICAgICAgQiAtLT4gQ1siUHJpdnkgU0RLPGJyPnNlbmRUcmFuc2FjdGlvbigpIl0KICAgIGVuZAoKICAgIHN1YmdyYXBoICJCbG9ja2NoYWluIgogICAgICAgIEMgLS0+IERbIlVTREMudHJhbnNmZXIoKTxicj5idXllciAtPiBlc2Nyb3cgd2FsbGV0Il0KICAgICAgICBEIC0tPiBFWyJ0eEhhc2ggY29uZmlybWVkIl0KICAgIGVuZAoKICAgIHN1YmdyYXBoICJFZGdlIEZ1bmN0aW9uIgogICAgICAgIEUgLS0+IEZbIlBPU1QgL2VzY3Jvdy9kZXBvc2l0Il0KICAgICAgICBGIC0tPiBHWyJWZXJpZnkgcGFzc2tleTxicj5hc3NlcnRpb24iXQogICAgICAgIEcgLS0+IEhbIlZhbGlkYXRlIGxpc3Rpbmc8YnI+KGFjdGl2ZSwgbm90IG93bikiXQogICAgZW5kCgogICAgc3ViZ3JhcGggIkRhdGFiYXNlIgogICAgICAgIEggLS0+IElbIklOU0VSVCBlc2Nyb3c8YnI+c3RhdHVzOiBkZXBvc2l0ZWQ8YnI+ZXhwaXJlc19hdDogKzQ4aCJdCiAgICAgICAgSSAtLT4gSlsiVVBEQVRFIGxpc3Rpbmc8YnI+c3RhdHVzOiBwZW5kaW5nIl0KICAgIGVuZA==)

### 3b. Fund Release Data Flow

Shows how data moves when a seller confirms the handoff and funds are released.

![Fund Release Data Flow](https://mermaid.ink/img/Z3JhcGggTFIKICAgIHN1YmdyYXBoICJTZWxsZXIgQWN0aW9uIgogICAgICAgIEFbIlBPU1QgL2VzY3Jvdy9jb25maXJtIl0gLS0+IEJbIlZlcmlmeSBzZWxsZXI8YnI+cm9sZSArIHN0YXR1cyJdCiAgICBlbmQKCiAgICBzdWJncmFwaCAiT24tQ2hhaW4gUmVsZWFzZSIKICAgICAgICBCIC0tPiBDWyJlbmNvZGVGdW5jdGlvbkRhdGEoKTxicj5VU0RDLnRyYW5zZmVyKHNlbGxlciwgdG90YWwpIl0KICAgICAgICBDIC0tPiBEWyJQcml2eSBzZW5kVHJhbnNhY3Rpb24oKTxicj5mcm9tIGVzY3JvdyB3YWxsZXQiXQogICAgICAgIEQgLS0+IEVbIkJhc2UgU2Vwb2xpYTxicj5VU0RDIGNvbmZpcm1lZCJdCiAgICBlbmQKCiAgICBzdWJncmFwaCAiRGF0YWJhc2UiCiAgICAgICAgRSAtLT4gRlsiZXNjcm93LnN0YXR1czxicj49IHJlbGVhc2VkIl0KICAgICAgICBGIC0tPiBHWyJsaXN0aW5nLnN0YXR1czxicj49IHNvbGQiXQogICAgZW5kCgogICAgc3ViZ3JhcGggIk5vdGlmaWNhdGlvbnMiCiAgICAgICAgRyAtLT4gSFsiRW1haWwgYnV5ZXI8YnI+dmlhIFJlc2VuZCJdCiAgICAgICAgRyAtLT4gSVsiRW1haWwgc2VsbGVyPGJyPnZpYSBSZXNlbmQiXQogICAgZW5k)

---

## 4. Escrow State Machine

![Escrow State Machine](https://mermaid.ink/img/c3RhdGVEaWFncmFtLXYyCiAgICBbKl0gLS0+IGRlcG9zaXRlZCA6IEJ1eWVyIGRlcG9zaXRzIFVTREMKCiAgICBkZXBvc2l0ZWQgLS0+IGFjY2VwdGVkIDogU2VsbGVyIGFjY2VwdHMKICAgIGRlcG9zaXRlZCAtLT4gcmVqZWN0ZWQgOiBTZWxsZXIgcmVqZWN0cyAtPiByZWZ1bmQKICAgIGRlcG9zaXRlZCAtLT4gY2FuY2VsbGVkIDogQnV5ZXIgY2FuY2VscyAtPiByZWZ1bmQKICAgIGRlcG9zaXRlZCAtLT4gZXhwaXJlZCA6IDQ4aCB0aW1lb3V0IC0+IGF1dG8tcmVmdW5kCiAgICBkZXBvc2l0ZWQgLS0+IGRpc3B1dGVkIDogRWl0aGVyIHBhcnR5IGRpc3B1dGVzCgogICAgYWNjZXB0ZWQgLS0+IGJ1eWVyX2NvbmZpcm1lZCA6IEJ1eWVyIGNvbmZpcm1zICsgcGF5cyByZW1haW5pbmcKICAgIGFjY2VwdGVkIC0tPiBjYW5jZWxsZWQgOiBCdXllciBjYW5jZWxzIC0+IHJlZnVuZAogICAgYWNjZXB0ZWQgLS0+IGRpc3B1dGVkIDogRWl0aGVyIHBhcnR5IGRpc3B1dGVzCgogICAgYnV5ZXJfY29uZmlybWVkIC0tPiByZWxlYXNlZCA6IFNlbGxlciBjb25maXJtcyAtPiBmdW5kcyByZWxlYXNlZAogICAgYnV5ZXJfY29uZmlybWVkIC0tPiBkaXNwdXRlZCA6IEVpdGhlciBwYXJ0eSBkaXNwdXRlcwoKICAgIHJlbGVhc2VkIC0tPiBbKl0KICAgIHJlamVjdGVkIC0tPiBbKl0KICAgIGNhbmNlbGxlZCAtLT4gWypdCiAgICBleHBpcmVkIC0tPiBbKl0KICAgIGRpc3B1dGVkIC0tPiBbKl0=)

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

![Agent Coordination Flow](https://mermaid.ink/img/c2VxdWVuY2VEaWFncmFtCiAgICBhY3RvciBCdXllcgogICAgYWN0b3IgU2VsbGVyCiAgICBwYXJ0aWNpcGFudCBVSSBhcyBFc2Nyb3cgVUkKICAgIHBhcnRpY2lwYW50IEVGIGFzIG5pY2hlLWFwaQogICAgcGFydGljaXBhbnQgQWdlbnQgYXMgTWVldHVwIEFnZW50CiAgICBwYXJ0aWNpcGFudCBTTVMgYXMgVHdpbGlvIFNNUwoKICAgIE5vdGUgb3ZlciBFRjogRXNjcm93IHN0YXR1cyAtPiBhY2NlcHRlZAogICAgRUYtLT4-VUk6IFNob3cgcGhvbmUgbnVtYmVyIGlucHV0CgogICAgQnV5ZXItPj5VSTogRW50ZXIgcGhvbmUgbnVtYmVyCiAgICBVSS0-PkFnZW50OiBSZWdpc3RlciBidXllciBwaG9uZSAoZW5jcnlwdGVkLCBieXBhc3NlcyBhcHAgREIpCgogICAgU2VsbGVyLT4-VUk6IEVudGVyIHBob25lIG51bWJlcgogICAgVUktPj5BZ2VudDogUmVnaXN0ZXIgc2VsbGVyIHBob25lIChlbmNyeXB0ZWQsIGJ5cGFzc2VzIGFwcCBEQikKCiAgICBOb3RlIG92ZXIgQWdlbnQ6IEJvdGggcGhvbmVzIHJlZ2lzdGVyZWQgLSBiZWdpbiBjb29yZGluYXRpb24KCiAgICBBZ2VudC0-PlNNUzogVGV4dCBidXllcgogICAgU01TLT4-QnV5ZXI6IEhpISBJbSBjb29yZGluYXRpbmcgeW91ciBNYWMgTWluaSBtZWV0dXAuIFdoYXQgYXJlYSBhbmQgdGltZXMgd29yayBmb3IgeW91PwogICAgQnV5ZXItLT4-U01TOiBEb3dudG93biBTRiwgd2Vla2RheSBldmVuaW5ncwogICAgU01TLT4-QWdlbnQ6IEZvcndhcmQgcmVwbHkKCiAgICBBZ2VudC0-PlNNUzogVGV4dCBzZWxsZXIKICAgIFNNUy0-PlNlbGxlcjogQnV5ZXIgaXMgYXZhaWxhYmxlIGRvd250b3duLCB3ZWVrZGF5IGV2ZW5pbmdzLiBJZCBzdWdnZXN0IEFwcGxlIFN0b3JlIFVuaW9uIFNxdWFyZS4KICAgIFNlbGxlci0tPj5TTVM6IEFwcGxlIFN0b3JlIFRodXJzZGF5IDZwbSB3b3JrcwogICAgU01TLT4-QWdlbnQ6IEZvcndhcmQgcmVwbHkKCiAgICBBZ2VudC0-PlNNUzogVGV4dCBidXllcgogICAgU01TLT4-QnV5ZXI6IFNlbGxlciBzdWdnZXN0cyBBcHBsZSBTdG9yZSBVbmlvbiBTcXVhcmUsIFRodXJzZGF5IDZwbS4gQ29uZmlybT8KICAgIEJ1eWVyLS0-PlNNUzogWUVTCiAgICBTTVMtPj5BZ2VudDogRm9yd2FyZCBjb25maXJtYXRpb24KCiAgICBBZ2VudC0-PlNNUzogVGV4dCBzZWxsZXIKICAgIFNNUy0-PlNlbGxlcjogQ29uZmlybWVkISBBcHBsZSBTdG9yZSBVbmlvbiBTcXVhcmUsIFRodXJzZGF5IDZwbS4KCiAgICBBZ2VudC0-PkVGOiBQT1NUIC9lc2Nyb3cvOmlkL21lc3NhZ2VzIChzeXN0ZW0gbWVzc2FnZSkKICAgIEVGLS0-PlVJOiBNZWV0dXAgY29uZmlybWVkIHZpYSBhZ2VudCAtIFRodXJzZGF5IDZwbQoKICAgIE5vdGUgb3ZlciBBZ2VudDogQXV0by1kZWxldGUgcGhvbmUgbnVtYmVycyBhZnRlciA3Mmg=)

### Privacy Boundary

![Privacy Boundary](https://mermaid.ink/img/Z3JhcGggVEIKICAgIHN1YmdyYXBoIEFwcERvbWFpblsiQXBwIERvbWFpbiAtIFN1cGFiYXNlIl0KICAgICAgICBEQlsiUG9zdGdyZVNRTCJdCiAgICAgICAgRUZbIkVkZ2UgRnVuY3Rpb24iXQogICAgICAgIENoYXRbIk1lc3NhZ2VzIFRhYmxlIl0KCiAgICAgICAgREIgLS4tIE5vUGhvbmVbIk5vIHBob25lIG51bWJlcnMiXQogICAgICAgIERCIC0uLSBOb0xvY2F0aW9uWyJObyBhZGRyZXNzZXMgb3IgR1BTIl0KICAgICAgICBDaGF0IC0uLSBPbmx5Q29uZmlybVsiT25seSBjb25maXJtYXRpb24gc3VtbWFyeTxicj5NZWV0dXAgY29uZmlybWVkIC0gVGh1cnNkYXkgNnBtIl0KICAgIGVuZAoKICAgIHN1YmdyYXBoIEFnZW50RG9tYWluWyJBZ2VudCBEb21haW4gLSBUd2lsaW8iXQogICAgICAgIFRXWyJUd2lsaW8gU01TIFNlcnZpY2UiXQogICAgICAgIEFJWyJBSSBDb29yZGluYXRpb24gQWdlbnQiXQogICAgICAgIEVwaGVtZXJhbFsiRXBoZW1lcmFsIFBob25lIFN0b3JlPGJyPjcyaCBhdXRvLWRlbGV0ZSJdCiAgICBlbmQKCiAgICBFRiAtLT58IkVzY3JvdyBJRCBvbmx5InwgQUkKICAgIFVJMlsiRXNjcm93IFVJIl0gLS0+fCJQaG9uZSBudW1iZXIgKGVuY3J5cHRlZCkifCBBSQogICAgQUkgLS0+fCJTTVMgdmlhInwgVFcKICAgIEFJIC0tPnwiQ29uZmlybWF0aW9uIHN1bW1hcnkifCBFRgogICAgVFcgLS0+fCJTdG9yZXMgaW4ifCBFcGhlbWVyYWw=)

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

![Deployment Architecture](https://mermaid.ink/img/Z3JhcGggVEIKICAgIHN1YmdyYXBoIFZlcmNlbFsiVmVyY2VsIl0KICAgICAgICBVSVsibmljaGUtdWk8YnI+TmV4dC5qcyAxNTxicj5TU1IgKyBTdGF0aWMiXQogICAgZW5kCgogICAgc3ViZ3JhcGggU3VwYWJhc2VbIlN1cGFiYXNlIl0KICAgICAgICBFRlsibmljaGUtYXBpPGJyPkRlbm8gRWRnZSBGdW5jdGlvbiJdCiAgICAgICAgUEdbIlBvc3RncmVTUUwiXQogICAgICAgIFJFU1RbIlBvc3RnUkVTVCJdCiAgICAgICAgVmF1bHRbIlZhdWx0PGJyPihlbmNyeXB0ZWQgc2VjcmV0cykiXQogICAgZW5kCgogICAgc3ViZ3JhcGggUHJpdnlDbG91ZFsiUHJpdnkiXQogICAgICAgIEF1dGhbIk9BdXRoICsgUGFzc2tleXMiXQogICAgICAgIFdhbGxldHNbIlNlcnZlciBXYWxsZXRzIl0KICAgICAgICBHYXNbIkdhcyBTcG9uc29yc2hpcCJdCiAgICBlbmQKCiAgICBzdWJncmFwaCBCYXNlU2Vwb2xpYVsiQmFzZSBTZXBvbGlhIl0KICAgICAgICBVU0RDWyJVU0RDIENvbnRyYWN0Il0KICAgIGVuZAoKICAgIHN1YmdyYXBoIENvbW1zWyJDb21tdW5pY2F0aW9ucyJdCiAgICAgICAgUmVzZW5kU3ZjWyJSZXNlbmQgwrcgRW1haWwiXQogICAgICAgIFR3aWxpb1N2Y1siVHdpbGlvIMK3IFNNUyJdCiAgICBlbmQKCiAgICBVSSAtLT4gRUYKICAgIFVJIC0tPiBSRVNUCiAgICBFRiAtLT4gUEcKICAgIEVGIC0tPiBWYXVsdAogICAgRUYgLS0+IEF1dGgKICAgIEVGIC0tPiBXYWxsZXRzCiAgICBXYWxsZXRzIC0tPiBVU0RDCiAgICBHYXMgLS0+IFVTREMKICAgIEVGIC0tPiBSZXNlbmRTdmMKICAgIEVGIC0tPiBUd2lsaW9TdmM=)

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

![Database Schema](https://mermaid.ink/img/ZXJEaWFncmFtCiAgICB1c2VycyB7CiAgICAgICAgdXVpZCBpZCBQSwogICAgICAgIHRleHQgY2hhbm5lbF9pZAogICAgICAgIHRleHQgY2hhbm5lbF90eXBlCiAgICAgICAgdGV4dCB3YWxsZXRfYWRkcmVzcwogICAgICAgIHRleHQgZGlzcGxheV9uYW1lCiAgICAgICAgdGV4dCB0d2l0dGVyX3VzZXJuYW1lCiAgICAgICAgdGV4dCB0d2l0dGVyX3VzZXJfaWQKICAgICAgICB0ZXh0IHBhc3NrZXlfcHVibGljX2tleQogICAgICAgIHRleHQgcGFzc2tleV9jcmVkZW50aWFsX2lkCiAgICAgICAgdGltZXN0YW1wdHogY3JlYXRlZF9hdAogICAgfQoKICAgIGxpc3RpbmdzIHsKICAgICAgICB1dWlkIGlkIFBLCiAgICAgICAgdXVpZCB1c2VyX2lkIEZLCiAgICAgICAgdGV4dCBpdGVtX25hbWUKICAgICAgICBudW1lcmljIHByaWNlCiAgICAgICAgbnVtZXJpYyBtaW5fZGVwb3NpdAogICAgICAgIHRleHQgaXRlbV9kZXNjcmlwdGlvbgogICAgICAgIHRleHQgY2F0ZWdvcnkKICAgICAgICB0ZXh0IHN0YXR1cwogICAgICAgIHRleHQgY2hpcAogICAgICAgIGludGVnZXIgcmFtCiAgICAgICAgaW50ZWdlciBzdG9yYWdlCiAgICAgICAgdGV4dCBjb25kaXRpb24KICAgICAgICBpbnRlZ2VyIHllYXIKICAgICAgICBib29sZWFuIGhhc193YXJyYW50eQogICAgICAgIGJvb2xlYW4gaW5jbHVkZXNfYm94CiAgICAgICAgdGV4dCBpbmNsdWRlc19hY2Nlc3NvcmllcwogICAgICAgIHRpbWVzdGFtcHR6IGNyZWF0ZWRfYXQKICAgIH0KCiAgICBlc2Nyb3dzIHsKICAgICAgICB1dWlkIGlkIFBLCiAgICAgICAgdXVpZCBsaXN0aW5nX2lkIEZLCiAgICAgICAgdXVpZCBidXllcl9pZCBGSwogICAgICAgIHV1aWQgc2VsbGVyX2lkIEZLCiAgICAgICAgbnVtZXJpYyBkZXBvc2l0X2Ftb3VudAogICAgICAgIG51bWVyaWMgdG90YWxfcHJpY2UKICAgICAgICBudW1lcmljIHJlbWFpbmluZ19hbW91bnQKICAgICAgICB0ZXh0IGN1cnJlbmN5CiAgICAgICAgdGV4dCBlc2Nyb3dfc2VydmljZQogICAgICAgIHRleHQgc3RhdHVzCiAgICAgICAgYm9vbGVhbiBidXllcl9jb25maXJtZWQKICAgICAgICBib29sZWFuIHNlbGxlcl9jb25maXJtZWQKICAgICAgICB0ZXh0IGRlcG9zaXRfdHhfaGFzaAogICAgICAgIHRleHQgcmVtYWluaW5nX3BheW1lbnRfdHhfaGFzaAogICAgICAgIHRleHQgcmVsZWFzZV90eF9oYXNoCiAgICAgICAgdGltZXN0YW1wdHogYWNjZXB0ZWRfYXQKICAgICAgICB0aW1lc3RhbXB0eiBleHBpcmVzX2F0CiAgICAgICAgdGltZXN0YW1wdHogY29uZmlybWVkX2F0CiAgICAgICAgdGltZXN0YW1wdHogY3JlYXRlZF9hdAogICAgfQoKICAgIG1lc3NhZ2VzIHsKICAgICAgICB1dWlkIGlkIFBLCiAgICAgICAgdXVpZCBlc2Nyb3dfaWQgRksKICAgICAgICB1dWlkIHNlbmRlcl9pZCBGSwogICAgICAgIHRleHQgYm9keQogICAgICAgIHRpbWVzdGFtcHR6IGNyZWF0ZWRfYXQKICAgIH0KCiAgICB3YXRjaGVzIHsKICAgICAgICB1dWlkIGlkIFBLCiAgICAgICAgdXVpZCB1c2VyX2lkIEZLCiAgICAgICAgdGV4dCBjYXRlZ29yaWVzCiAgICAgICAgbnVtZXJpYyBtYXhfcHJpY2UKICAgICAgICB0aW1lc3RhbXB0eiBjcmVhdGVkX2F0CiAgICB9CgogICAgdXNlcnMgfHwtLW97IGxpc3RpbmdzIDogc2VsbHMKICAgIHVzZXJzIHx8LS1veyBlc2Nyb3dzIDogYnV5cyBhcyBidXllcl9pZAogICAgdXNlcnMgfHwtLW97IGVzY3Jvd3MgOiBzZWxscyBhcyBzZWxsZXJfaWQKICAgIHVzZXJzIHx8LS1veyBtZXNzYWdlcyA6IHNlbmRzCiAgICB1c2VycyB8fC0tb3sgd2F0Y2hlcyA6IHdhdGNoZXMKICAgIGxpc3RpbmdzIHx8LS1veyBlc2Nyb3dzIDogY2xhaW1lZCB2aWEKICAgIGVzY3Jvd3MgfHwtLW97IG1lc3NhZ2VzIDogY29udGFpbnM=)

### Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_listings_chip` | listings | chip | Filter by Apple Silicon chip |
| `idx_listings_ram` | listings | ram | Filter by RAM |
| `idx_listings_condition` | listings | condition | Filter by condition |
| `idx_messages_escrow` | messages | escrow_id, created_at | Fast message retrieval per escrow |
| `idx_escrows_remaining_tx` | escrows | remaining_payment_tx_hash | Transaction lookup |
