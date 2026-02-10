"use client";

import { useState, useEffect, Suspense } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { saveAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/authed-api";

function SetupPasskeyInner() {
  const { user, authenticated } = usePrivy();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback");
  const [status, setStatus] = useState<{ msg: string; type: "loading" | "error" } | null>(null);
  const [wallet, setWallet] = useState("");

  useEffect(() => {
    if (!authenticated || !user) {
      router.push("/login");
    }
  }, [authenticated, user, router]);

  async function handlePasskeySetup() {
    if (!user) return;

    setStatus({ msg: "Setting up passkey...", type: "loading" });

    const twitterAccount = user.twitter;
    const twitterUsername = twitterAccount?.username || "";
    const twitterUserId = twitterAccount?.subject || "";

    try {
      // Generate challenge locally — WebAuthn only needs a random value
      // to prevent replay attacks. No server round-trip needed.
      const challengeBytes = new Uint8Array(32);
      crypto.getRandomValues(challengeBytes);
      const userIdBytes = Uint8Array.from(user.id, (c) => c.charCodeAt(0));

      // Create WebAuthn credential
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: challengeBytes,
          rp: {
            name: "Niche",
            id: window.location.hostname,
          },
          user: {
            id: userIdBytes,
            name: twitterUsername,
            displayName: `@${twitterUsername}`,
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" }, // ES256
            { alg: -257, type: "public-key" }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "preferred",
          },
          timeout: 60000,
        },
      });

      if (!credential) {
        throw new Error("No credential returned");
      }

      const pubKeyCred = credential as PublicKeyCredential;
      const response = pubKeyCred.response as AuthenticatorAttestationResponse;

      // Encode credential data
      const credentialId = btoa(String.fromCharCode(...new Uint8Array(pubKeyCred.rawId)));
      const publicKey = btoa(
        String.fromCharCode(...new Uint8Array(response.getPublicKey()!))
      );

      // Create wallet via backend (JWT-authenticated)
      setStatus({ msg: "Creating wallet...", type: "loading" });
      const walletRes = await authedFetch("/auth/wallet", {
        method: "POST",
        body: JSON.stringify({
          twitterUsername,
          twitterUserId,
          passkey: {
            credentialId,
            publicKey,
          },
        }),
      });

      if (!walletRes.ok) {
        const errData = await walletRes.json();
        throw new Error(errData.error || "Wallet creation failed");
      }

      const walletData = await walletRes.json();

      const authData = {
        privyUserId: user.id,
        email: user.email?.address,
        wallet: walletData.wallet,
        walletId: walletData.walletId,
        userId: walletData.userId,
        twitterUsername,
        passkey: {
          credentialId,
          publicKey,
        },
      };

      // Save auth to localStorage
      saveAuth(authData);

      setWallet(walletData.wallet);
      setStatus(null);

      // If CLI/agent callback URL is set, redirect there with auth data
      if (callbackUrl) {
        const cbUrl = new URL(callbackUrl);
        cbUrl.searchParams.set("data", JSON.stringify(authData));
        window.location.href = cbUrl.toString();
        return;
      }

      // Redirect to home after short delay
      setTimeout(() => {
        router.push("/");
      }, 2000);
    } catch (err) {
      setStatus({
        msg: `Setup failed: ${(err as Error).message}`,
        type: "error",
      });
    }
  }

  if (!authenticated || !user) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 border border-border bg-surface text-center">
        <div className="spinner mx-auto mb-4" />
        <p className="text-text-secondary">Redirecting...</p>
      </div>
    );
  }

  if (wallet) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 border border-border bg-surface text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold mb-4">Account Ready!</h2>
        <p className="text-sm text-text-secondary mb-2">Your wallet has been created</p>
        <div className="font-mono text-xs text-text-tertiary mb-6 break-all">{wallet}</div>
        <p className="text-sm text-text-secondary">Redirecting to marketplace...</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-16 p-8 border border-border bg-surface">
      <h2 className="text-2xl font-bold mb-4">Setup Passkey</h2>
      <p className="text-sm text-text-secondary mb-6">
        Register your passkey (Touch ID / Face ID) to sign transactions securely
      </p>

      {status && (
        <div
          className={`mb-4 p-3 text-sm ${
            status.type === "error"
              ? "bg-error/10 text-error border border-error"
              : "bg-pending/10 text-pending border border-pending"
          }`}
        >
          {status.msg}
        </div>
      )}

      <button
        onClick={handlePasskeySetup}
        disabled={status?.type === "loading"}
        className="w-full px-6 py-3 bg-accent text-bg font-semibold hover:bg-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status?.type === "loading" ? "Setting up..." : "Register Passkey"}
      </button>
    </div>
  );
}

export default function SetupPasskeyPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto mt-16 p-8 border border-border bg-surface text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-text-secondary">Loading...</p>
        </div>
      }
    >
      <SetupPasskeyInner />
    </Suspense>
  );
}
