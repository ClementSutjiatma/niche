"use client";

import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuth, saveAuth } from "@/lib/auth";
import { API_BASE, SUPABASE_ANON_KEY } from "@/lib/api";

export function LoginForm() {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect");
  const callbackUrl = searchParams.get("callback"); // localhost callback for CLI/agent auth

  // Log Privy initialization state
  useEffect(() => {
    console.log('=== PRIVY INITIALIZATION ===');
    console.log('Ready:', ready);
    console.log('Authenticated:', authenticated);
    console.log('User:', user);
    console.log('User has Twitter?:', !!user?.twitter);
    console.log('===========================');
  }, [ready, authenticated, user]);

  // Check if already authenticated
  useEffect(() => {
    console.log('=== CHECKING EXISTING AUTH ===');
    const existing = getAuth();
    console.log('Existing auth:', existing);
    if (existing?.wallet) {
      const dest = redirectPath && redirectPath.startsWith("/") ? redirectPath : "/";
      console.log('Already authenticated, redirecting to:', dest);
      router.push(dest);
    } else {
      console.log('No existing wallet found in localStorage');
    }
    console.log('==============================');
  }, [redirectPath, router]);

  // Handle post-authentication
  useEffect(() => {
    console.log('=== POST-AUTH EFFECT ===');
    console.log('Ready:', ready, 'Authenticated:', authenticated, 'User:', !!user);

    if (!ready || !authenticated || !user) {
      console.log('Skipping post-auth: not ready or not authenticated');
      return;
    }

    async function handlePostAuth(currentUser: NonNullable<typeof user>) {
      console.log('=== HANDLING POST AUTH ===');
      console.log('Full user object:', JSON.stringify(currentUser, null, 2));

      // Extract Twitter data from Privy user
      const twitterAccount = currentUser.twitter;
      console.log('Twitter account:', JSON.stringify(twitterAccount, null, 2));

      const twitterUsername = twitterAccount?.username;
      const twitterUserId = twitterAccount?.subject;
      console.log('Twitter username:', twitterUsername);
      console.log('Twitter user ID:', twitterUserId);

      if (!twitterUsername || !twitterUserId) {
        console.error('❌ Twitter account data incomplete');
        console.error('Twitter account object:', twitterAccount);
        console.error('Available linked accounts:', Object.keys(currentUser));
        console.error('Privy user ID:', currentUser.id);
        alert(`Twitter authentication incomplete. Twitter username: ${twitterUsername}, Twitter ID: ${twitterUserId}`);
        return;
      }

      try {
        console.log('🔍 Checking if user exists in database...');
        console.log('Request payload:', {
          privyUserId: currentUser.id,
          twitterUsername,
          twitterUserId,
        });

        // Check if user exists in database
        const lookupRes = await fetch(`${API_BASE}/auth/lookup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            privyUserId: currentUser.id,
            twitterUsername,
            twitterUserId,
          }),
        });

        console.log('Lookup response status:', lookupRes.status);
        console.log('Lookup response ok:', lookupRes.ok);

        if (lookupRes.ok) {
          const data = await lookupRes.json();
          console.log('Lookup response data:', data);

          if (data.wallet) {
            console.log('✅ User exists with wallet:', data.wallet);
            // User exists with wallet, save and redirect
            const authData = {
              privyUserId: currentUser.id,
              email: currentUser.email?.address,
              wallet: data.wallet,
              walletId: data.walletId,
              userId: data.userId,
              twitterUsername: twitterUsername,
              // Restore passkey data from backend so deposit flow works
              ...(data.passkeyCredentialId && {
                passkey: {
                  credentialId: data.passkeyCredentialId,
                  publicKey: data.passkeyPublicKey || "",
                },
              }),
            };
            saveAuth(authData);

            // If CLI/agent callback URL is set, redirect there with auth data
            if (callbackUrl) {
              const cbUrl = new URL(callbackUrl);
              cbUrl.searchParams.set("data", JSON.stringify(authData));
              console.log('Redirecting to CLI callback:', cbUrl.toString());
              window.location.href = cbUrl.toString();
              return;
            }

            const dest = redirectPath && redirectPath.startsWith("/") ? redirectPath : "/";
            console.log('Redirecting to:', dest);
            router.push(dest);
            return;
          } else {
            console.log('⚠️ User exists but no wallet found');
          }
        } else {
          const errorText = await lookupRes.text();
          console.error('❌ Lookup request failed:', errorText);
        }

        // No wallet found, need to create one
        // This will be handled by the passkey flow
        console.log('🔐 Redirecting to passkey setup...');
        const passkeyUrl = callbackUrl
          ? `/login/setup-passkey?callback=${encodeURIComponent(callbackUrl)}`
          : "/login/setup-passkey";
        router.push(passkeyUrl);
      } catch (err) {
        console.error("❌ Auth lookup failed:", err);
        console.error('Error details:', {
          message: (err as Error).message,
          stack: (err as Error).stack,
        });
      }
      console.log('======================');
    }

    handlePostAuth(user);
  }, [ready, authenticated, user, redirectPath, callbackUrl, router]);

  if (!ready) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 border border-border bg-surface text-center">
        <div className="spinner mx-auto mb-4" />
        <p className="text-text-secondary">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-16 p-8 border border-border bg-surface">
      <h1 className="text-3xl font-bold mb-6 text-center">Login to Niche</h1>
      <p className="text-sm text-text-secondary mb-8 text-center">
        Connect your Twitter/X account to start trading cards with on-chain escrow
      </p>

      {authenticated && user && !user.twitter && (
        <div className="mb-4 p-4 bg-error/10 border border-error text-sm">
          <p className="font-semibold mb-2">Legacy Session Detected</p>
          <p className="text-text-secondary mb-3">
            You're logged in with an old email session. Please log out and sign in with Twitter.
          </p>
          <button
            onClick={async () => {
              await logout();
              window.location.reload();
            }}
            className="px-4 py-2 bg-error text-white hover:bg-error/90 transition-colors"
          >
            Logout and Refresh
          </button>
        </div>
      )}

      <button
        onClick={async () => {
          console.log('=== LOGIN BUTTON CLICKED ===');
          console.log('Timestamp:', new Date().toISOString());
          console.log('Privy ready:', ready);
          console.log('Authenticated:', authenticated);
          console.log('User exists:', !!user);
          console.log('User has Twitter:', !!user?.twitter);

          if (authenticated && user && !user.twitter) {
            console.log('❌ Legacy session detected, cannot login');
            alert('Please logout first using the button above');
            return;
          }

          console.log('🚀 Calling Privy login()...');
          console.log('Current URL:', window.location.href);
          console.log('Redirect path:', redirectPath);

          try {
            await login();
            console.log('✅ Login method completed');
          } catch (error) {
            console.error('❌ Login method failed:', error);
            console.error('Error details:', {
              message: (error as Error).message,
              name: (error as Error).name,
              stack: (error as Error).stack,
            });
          }
          console.log('===========================');
        }}
        disabled={!ready || Boolean(authenticated && user && !user.twitter)}
        className="w-full px-6 py-3 bg-accent text-bg font-semibold hover:bg-text-primary transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        {ready ? 'Continue with Twitter/X' : 'Loading...'}
      </button>

      <p className="mt-6 text-xs text-text-tertiary text-center">
        By continuing, you agree to create a wallet and authenticate via passkey
        (Touch ID / Face ID)
      </p>
    </div>
  );
}
