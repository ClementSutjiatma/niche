# Deploy Supabase Edge Function

The `niche-api` Edge Function has been updated with passkey enforcement endpoints. Follow these steps to deploy:

## Option 1: Deploy via Supabase CLI

If you have the Supabase CLI installed:

```bash
cd /Users/clementsutjiatma/.openclaw/workspace/skills/niche
supabase functions deploy niche-api
```

## Option 2: Deploy via Supabase Dashboard

1. Go to https://supabase.com/dashboard
2. Select your project
3. Navigate to **Edge Functions** in the sidebar
4. Click on **niche-api** function
5. Click **Deploy new version**
6. Upload the file: `supabase/functions/niche-api/index.ts`
7. Click **Deploy**

## New Endpoints Added

### GET /auth/passkey-status?email={email}
Checks if a user has a passkey registered.

**Response:**
```json
{
  "hasPasskey": true,
  "userId": "uuid",
  "needsPasskey": false
}
```

### POST /auth/register-passkey
Registers a passkey for an existing user who doesn't have one.

**Body:**
```json
{
  "email": "user@example.com",
  "passkey": {
    "publicKey": "base64...",
    "credentialId": "base64..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Passkey registered successfully"
}
```

## What Changed

1. **Passkey Status Check**: New endpoint to verify if users have passkeys
2. **Passkey Registration**: New endpoint to register passkeys for existing users
3. **Enhanced Security**: All transaction flows now require passkeys

## Testing

After deployment, test the passkey enforcement:

1. **New User Flow**:
   - Sign up with email
   - Should be forced to register passkey
   - Cannot skip passkey registration

2. **Existing User Without Passkey**:
   - Login with email
   - Should be prompted to register passkey
   - Cannot perform transactions until passkey is registered

3. **Existing User With Passkey**:
   - Login with email
   - Should login normally without passkey prompt
   - Can perform transactions immediately

## Rollback

If you need to rollback, redeploy the previous version from the Supabase dashboard history.
