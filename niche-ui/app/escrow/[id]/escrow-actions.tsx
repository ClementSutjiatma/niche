"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData } from "viem";
import { getAuth } from "@/lib/auth";
import { API_BASE, SUPABASE_ANON_KEY } from "@/lib/api";
import type { Escrow } from "@/lib/types";
import { EscrowChat } from "@/components/escrow-chat";

interface Props {
  escrow: Escrow;
}

type ActionStatus = { msg: string; type: "loading" | "error" | "success" } | null;

export function EscrowActions({ escrow }: Props) {
  const router = useRouter();
  const { sendTransaction } = useSendTransaction();
  const [status, setStatus] = useState<ActionStatus>(null);
  const [processing, setProcessing] = useState(false);
  const auth = getAuth();
  const isLoggedIn = !!auth?.wallet;

  const isBuyer = auth?.wallet === escrow.buyer?.wallet_address
    || auth?.userId === escrow.buyer_id
    || auth?.userId === escrow.buyer?.id;
  const isSeller = auth?.wallet === escrow.seller?.wallet_address
    || auth?.userId === escrow.seller_id
    || auth?.userId === escrow.seller?.id;

  // Time remaining before expiry (only for deposited state)
  const expiresAt = escrow.expires_at ? new Date(escrow.expires_at) : null;
  const now = new Date();
  const hoursLeft = expiresAt ? Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60))) : null;

  // --- Seller: Accept deposit ---
  async function handleAccept() {
    if (!isLoggedIn || !isSeller) return;
    setProcessing(true);
    setStatus({ msg: "Accepting deposit...", type: "loading" });

    try {
      const r = await fetch(`${API_BASE}/escrow/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          escrowId: escrow.id,
          walletAddress: auth.wallet,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to accept");
      setStatus({ msg: "Deposit accepted! Chat is now open.", type: "success" });
      setTimeout(() => router.refresh(), 1500);
    } catch (e: unknown) {
      setStatus({ msg: `Failed: ${(e as Error).message}`, type: "error" });
    } finally {
      setProcessing(false);
    }
  }

  // --- Seller: Reject deposit ---
  async function handleReject() {
    if (!isLoggedIn || !isSeller) return;
    if (!confirm("Reject this deposit? The buyer will be refunded.")) return;
    setProcessing(true);
    setStatus({ msg: "Rejecting and refunding...", type: "loading" });

    try {
      const r = await fetch(`${API_BASE}/escrow/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          escrowId: escrow.id,
          walletAddress: auth.wallet,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to reject");
      setStatus({ msg: "Deposit rejected. Buyer has been refunded.", type: "success" });
      setTimeout(() => router.refresh(), 1500);
    } catch (e: unknown) {
      setStatus({ msg: `Failed: ${(e as Error).message}`, type: "error" });
    } finally {
      setProcessing(false);
    }
  }

  // --- Buyer: Cancel deposit ---
  async function handleCancel() {
    if (!isLoggedIn || !isBuyer) return;
    setProcessing(true);
    setStatus({ msg: "Cancelling deposit...", type: "loading" });

    try {
      const r = await fetch(`${API_BASE}/escrow/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          escrowId: escrow.id,
          walletAddress: auth.wallet,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to cancel");
      setStatus({ msg: "Refund processed!", type: "success" });
      setTimeout(() => router.push("/"), 1500);
    } catch (e: unknown) {
      setStatus({ msg: `Failed: ${(e as Error).message}`, type: "error" });
    } finally {
      setProcessing(false);
    }
  }

  // --- Buyer: Confirm & pay remaining ---
  async function handleBuyerConfirm() {
    if (!isLoggedIn || !isBuyer) return;
    setProcessing(true);
    setStatus({ msg: "Signing with passkey...", type: "loading" });

    try {
      // 1. Passkey assertion
      const timestamp = Date.now();
      const encoder = new TextEncoder();
      const challengeData = encoder.encode(
        `${escrow.id}:${auth.wallet}:${escrow.remaining_amount}:${timestamp}`
      );
      const challenge = new Uint8Array(
        await crypto.subtle.digest("SHA-256", challengeData)
      );

      const allowCredentials: PublicKeyCredentialDescriptor[] = [];
      if (auth.passkey?.credentialId) {
        const rawId = Uint8Array.from(atob(auth.passkey.credentialId), (c) => c.charCodeAt(0));
        allowCredentials.push({ type: "public-key", id: rawId });
      }

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
          userVerification: "required",
          timeout: 120000,
        },
      })) as PublicKeyCredential;

      const response = assertion.response as AuthenticatorAssertionResponse;
      const passkeyData = {
        signature: btoa(String.fromCharCode(...new Uint8Array(response.signature))),
        authenticatorData: btoa(String.fromCharCode(...new Uint8Array(response.authenticatorData))),
        clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
      };

      setStatus({ msg: `Paying remaining $${escrow.remaining_amount}...`, type: "loading" });

      // 2. USDC transfer for remaining amount
      const USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
      const ESCROW_WALLET_ADDRESS = "0x6C5A9EC44f7979DC959d332Ce2B835301078e68B";

      const transferData = encodeFunctionData({
        abi: [{
          name: "transfer",
          type: "function",
          inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        }],
        functionName: "transfer",
        args: [ESCROW_WALLET_ADDRESS, BigInt(escrow.remaining_amount * 1_000_000)],
      });

      const txResponse = await sendTransaction(
        { to: USDC_CONTRACT, data: transferData, chainId: 84532 },
        { sponsor: true, uiOptions: { showWalletUIs: true } }
      );

      setStatus({ msg: "Confirming...", type: "loading" });

      // 3. Send to backend
      const r = await fetch(`${API_BASE}/escrow/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          escrowId: escrow.id,
          walletAddress: auth.wallet,
          remainingPaymentTxHash: txResponse.hash,
          passkey: passkeyData,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to confirm");

      setStatus({ msg: "Confirmed! Waiting for seller to release funds.", type: "success" });
      setTimeout(() => router.refresh(), 1500);
    } catch (e: unknown) {
      const err = e as Error & { name?: string };
      if (err.name === "NotAllowedError") {
        setStatus({ msg: "Cancelled.", type: "error" });
      } else {
        setStatus({ msg: `Failed: ${err.message}`, type: "error" });
      }
    } finally {
      setProcessing(false);
    }
  }

  // --- Seller: Confirm handoff & release funds ---
  async function handleSellerConfirm() {
    if (!isLoggedIn || !isSeller) return;
    setProcessing(true);
    setStatus({ msg: "Confirming and releasing funds...", type: "loading" });

    try {
      const r = await fetch(`${API_BASE}/escrow/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          escrowId: escrow.id,
          walletAddress: auth.wallet,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to confirm");

      setStatus({ msg: `Funds released to your wallet!`, type: "success" });
      setTimeout(() => router.refresh(), 1500);
    } catch (e: unknown) {
      setStatus({ msg: `Failed: ${(e as Error).message}`, type: "error" });
    } finally {
      setProcessing(false);
    }
  }

  // --- Dispute ---
  async function handleDispute() {
    if (!isLoggedIn) return;
    const reason = prompt("Reason for dispute:");
    if (!reason) return;
    setProcessing(true);
    setStatus({ msg: "Filing dispute...", type: "loading" });

    try {
      const r = await fetch(`${API_BASE}/escrow/dispute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          escrowId: escrow.id,
          walletAddress: auth.wallet,
          reason,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Dispute failed");
      setStatus({ msg: "Dispute filed. Funds are held pending resolution.", type: "success" });
      setTimeout(() => router.refresh(), 1500);
    } catch (e: unknown) {
      setStatus({ msg: `Failed: ${(e as Error).message}`, type: "error" });
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="max-w-[560px] mb-8">
      {/* Payment breakdown */}
      <h2 className="text-lg font-semibold mb-3">Payment Details</h2>
      <div className="bg-white/3 rounded-lg p-4 mb-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Deposit Placed</span>
            <span className="text-success">${escrow.deposit_amount} USD ✓</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Remaining Amount</span>
            <span className={escrow.remaining_payment_tx_hash ? "text-success" : "text-gray-300"}>
              ${escrow.remaining_amount} USD {escrow.remaining_payment_tx_hash && "✓"}
            </span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-2 font-semibold">
            <span>Total</span>
            <span>${escrow.total_price} USD</span>
          </div>
        </div>
      </div>

      {/* === STATE: deposited — seller must accept/reject === */}
      {escrow.status === "deposited" && (
        <>
          {isSeller && (
            <div className="mb-4">
              <p className="text-sm text-gray-400 mb-3">
                A buyer has placed a ${escrow.deposit_amount} deposit on your listing. Accept to start a chat and arrange a meetup.
              </p>
              {hoursLeft !== null && (
                <div className="text-xs text-gray-500 mb-3">
                  Auto-expires in {hoursLeft}h if no action taken.
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleAccept}
                  disabled={processing}
                  className="flex-1 py-3 rounded-lg bg-success/20 text-success border border-success/30 hover:bg-success/30 transition-colors font-semibold disabled:opacity-50"
                >
                  Accept Deposit
                </button>
                <button
                  onClick={handleReject}
                  disabled={processing}
                  className="flex-1 py-3 rounded-lg border border-red-500/30 text-red-400 font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {isBuyer && (
            <div className="mb-4">
              <p className="text-sm text-gray-400 mb-3">
                Waiting for the seller to accept your deposit.
                {hoursLeft !== null && ` Auto-refund in ${hoursLeft}h if no response.`}
              </p>
              <button
                onClick={handleCancel}
                disabled={processing}
                className="w-full py-2.5 rounded-lg border border-red-500/30 text-red-400 font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                Cancel & Get Refund
              </button>
            </div>
          )}
        </>
      )}

      {/* === STATE: accepted — chat open, buyer can confirm & pay === */}
      {escrow.status === "accepted" && (
        <>
          <EscrowChat escrowId={escrow.id} buyerId={escrow.buyer_id} sellerId={escrow.seller_id} />

          {isBuyer && (
            <div className="mt-4 mb-4">
              <p className="text-sm text-gray-400 mb-3">
                Meet the seller to inspect the Mac Mini. When ready, confirm and pay the remaining amount.
              </p>
              <button
                onClick={handleBuyerConfirm}
                disabled={processing}
                className="w-full py-3 rounded-lg bg-success/20 text-success border border-success/30 hover:bg-success/30 transition-colors font-semibold disabled:opacity-50"
              >
                Confirm & Pay ${escrow.remaining_amount}
              </button>
              <button
                onClick={handleCancel}
                disabled={processing}
                className="w-full py-2.5 mt-2 rounded-lg border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                Cancel & Get Refund
              </button>
            </div>
          )}

          {isSeller && (
            <div className="mt-4 mb-4">
              <p className="text-sm text-gray-400">
                Chat with the buyer to arrange a meetup. Once they inspect the Mac Mini, they'll confirm and pay the remaining ${escrow.remaining_amount}.
              </p>
            </div>
          )}
        </>
      )}

      {/* === STATE: buyer_confirmed — seller must confirm to release === */}
      {escrow.status === "buyer_confirmed" && (
        <>
          <EscrowChat escrowId={escrow.id} buyerId={escrow.buyer_id} sellerId={escrow.seller_id} />

          {isSeller && (
            <div className="mt-4 mb-4">
              <div className="bg-success/10 border border-success/20 rounded-lg p-3 text-sm text-success mb-3">
                Buyer has confirmed and paid the remaining ${escrow.remaining_amount}. Confirm the handoff to release ${escrow.total_price} to your wallet.
              </div>
              <button
                onClick={handleSellerConfirm}
                disabled={processing}
                className="w-full py-3 rounded-lg bg-brand text-black font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                Confirm & Release ${escrow.total_price} to My Wallet
              </button>
            </div>
          )}

          {isBuyer && (
            <div className="mt-4 mb-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-sm text-blue-200">
                You've confirmed and paid. Waiting for the seller to confirm the handoff and release funds.
              </div>
            </div>
          )}
        </>
      )}

      {/* Dispute button (available in active states) */}
      {["deposited", "accepted", "buyer_confirmed"].includes(escrow.status) && (isBuyer || isSeller) && (
        <button
          onClick={handleDispute}
          disabled={processing}
          className="w-full py-2.5 mt-2 rounded-lg text-sm font-semibold bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors disabled:opacity-50"
        >
          File Dispute
        </button>
      )}

      {/* Status display */}
      {status && (
        <div
          className={`mt-4 p-3 rounded-lg text-sm ${
            status.type === "loading"
              ? "bg-white/5 text-gray-300"
              : status.type === "success"
                ? "bg-success/10 text-success border border-success/20"
                : "bg-error/15 text-error border border-error/30"
          }`}
        >
          {status.type === "loading" && (
            <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
          )}
          {status.msg}
        </div>
      )}
    </div>
  );
}
