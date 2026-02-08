# Twitter/X Authentication Migration

This document outlines the changes made to integrate Twitter/X authentication for social trust in the Niche marketplace.

## Summary of Changes

### 1. **Authentication Flow**
- **Replaced**: Email + OTP authentication
- **With**: Twitter/X OAuth via Privy
- **Benefits**: Instant social verification, clickable X badges on listings

### 2. **Database Schema Changes**

**Migration File**: `supabase/migrations/20260207120000_add_twitter_username.sql`

Added two new columns to the `users` table:
- `twitter_username` (TEXT) - Twitter handle (e.g., "elonmusk")
- `twitter_user_id` (TEXT, UNIQUE) - Twitter user ID for unique identification

**To apply this migration**:
```bash
# Option 1: Using Supabase CLI (if installed)
supabase db push

# Option 2: Run SQL directly in Supabase dashboard
# Navigate to: SQL Editor → Paste migration SQL → Run
```

### 3. **Frontend Changes**

#### `app/providers.tsx`
- Added `loginMethods: ['twitter']` to Privy config
- Now only Twitter authentication is enabled

#### `app/login/login-form.tsx`
- Complete rewrite to use `usePrivy()` hook
- Simplified from 438 lines to 337 lines
- New flow: Twitter OAuth → Passkey → Wallet
- Button: "Continue with Twitter/X" with X logo

#### `components/listing-card.tsx`
- Added Twitter badge below card name
- Clickable link to `https://x.com/@username`
- Shows X icon + username
- Only displays if `twitter_username` exists

#### `app/listing/[id]/page.tsx`
- Added Twitter badge in "Listed by" section
- Includes Twitter username in seller info

#### `app/page.tsx`
- Updated query to select `twitter_username` and `twitter_user_id` from users

#### `lib/types.ts`
- Added `twitter_username` and `twitter_user_id` to `ListingUser` interface

### 4. **Backend Changes**

#### `supabase/functions/niche-api/index.ts`

**Updated Functions**:
1. `upsertUser()` - Now accepts Twitter fields
2. `handleAuthLookup()` - Checks both Twitter and email channels
3. `handleAuthWallet()` - Stores Twitter info when creating wallets

**Key Changes**:
- `channel_type` can now be `"twitter"` or `"email"`
- `channel_id` is `twitterUserId` for Twitter users
- `display_name` is `@username` for Twitter users

## Deployment Instructions

### Step 1: Enable Twitter OAuth in Privy Dashboard

1. Go to https://dashboard.privy.io
2. Navigate to your app: `cml8rx48y0035l80bdzfjpooo`
3. Go to **Settings** → **Login Methods**
4. Enable **Twitter/X OAuth**
5. Follow Privy's instructions to:
   - Create a Twitter Developer app at https://developer.twitter.com
   - Get your Twitter API Client ID and Client Secret
   - Add callback URL: `https://auth.privy.io/v1/oauth/callback`
   - Enter credentials in Privy dashboard

### Step 2: Apply Database Migration

**Option A: Supabase CLI** (recommended)
```bash
cd /Users/clementsutjiatma/.openclaw/workspace/skills/niche
supabase db push
```

**Option B: Supabase Dashboard**
1. Go to https://supabase.com/dashboard/project/uqedheymwswlbblximuq
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Paste contents of `supabase/migrations/20260207120000_add_twitter_username.sql`
5. Click **Run**

### Step 3: Deploy Frontend

The Vercel deployment will automatically pick up the new code:
```bash
# Commit changes
git add .
git commit -m "feat: add Twitter OAuth and social badges"
git push origin main

# Or deploy directly
cd niche-ui
vercel deploy --prod
```

### Step 4: Test the Flow

1. Visit the deployed site
2. Click "Login" in navigation
3. Click "Continue with Twitter/X"
4. Authorize the app
5. Complete passkey registration
6. Check that your Twitter username appears on any listings you create

## Rollback Instructions

If you need to revert to email authentication:

1. **Revert Frontend**: `git revert <commit-hash>`
2. **Privy Dashboard**: Disable Twitter OAuth, re-enable Email OTP
3. **Database**: Run this SQL to remove Twitter columns:
   ```sql
   ALTER TABLE users
     DROP COLUMN IF EXISTS twitter_username,
     DROP COLUMN IF EXISTS twitter_user_id;
   DROP INDEX IF EXISTS idx_users_twitter_id;
   ```

## Testing Checklist

- [ ] Twitter OAuth redirects correctly
- [ ] Passkey registration works after Twitter auth
- [ ] Wallet is created successfully
- [ ] Twitter username appears on listing cards
- [ ] Clicking Twitter badge opens X profile
- [ ] Backend stores `twitter_username` and `twitter_user_id`
- [ ] Existing email users can still access their accounts (if keeping email fallback)

## Notes

- **Email authentication is deprecated** - The `loginMethods` config only includes `['twitter']`
- **Twitter username is optional** - If not provided, user can still authenticate but won't have social badge
- **Unique constraint** - Each Twitter user ID can only link to one Niche account
- **Channel type** - Backend now supports `channel_type: "twitter"` alongside `"email"` and `"privy"`

## Support

If you encounter issues:
1. Check Privy dashboard logs
2. Check browser console for OAuth errors
3. Verify Twitter Developer app is configured correctly
4. Ensure database migration was applied successfully
