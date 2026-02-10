"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallets, useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData } from "viem";
import { getAuth } from "@/lib/auth";
import { API_BASE, BASESCAN_TX_URL } from "@/lib/api";
import { authedFetch } from "@/lib/authed-api";
import type { Escrow, EscrowDepositResponse } from "@/lib/types";

interface Props {
  listingId: string;
  itemName: string;
  price: number;
  minDeposit: number;
  category?: string;
  sellerUserId: string;
}

type Status = { msg: string; type: "loading" | "error" } | null;

export function ListingActions({
  listingId,
  itemName,
  price,
  minDeposit,
  category,
}: Props) {
  const router = useRouter();
  const { sendTransaction } = useSendTransaction();
  const [auth, setAuth] = useState(getAuth());
  const [showEscrow, setShowEscrow] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [depositResult, setDepositResult] =
    useState<EscrowDepositResponse | null>(null);
  const [signing, setSigning] = useState(false);
  const [existingEscrow, setExistingEscrow] = useState<Escrow | null>(null);
  const [loadingEscrow, setLoadingEscrow] = useState(true);

  const isLoggedIn = !!auth?.wallet;
  const loginRedirectEscrow = `/login?redirect=${encodeURIComponent(`/listing/${listingId}#escrow`)}`;

  // Check for existing escrow on this listing
  const fetchExistingEscrow = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/escrow/by-listing/${listingId}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.escrow) {
          setExistingEscrow(data.escrow);
        }
      }
    } catch {
      // Ignore fetch errors for existing escrow check
    } finally {
      setLoadingEscrow(false);
    }
  }, [listingId]);

  useEffect(() => {
    fetchExistingEscrow();
  }, [fetchExistingEscrow]);

  // Check #escrow hash on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#escrow") {
      const a = getAuth();
      setAuth(a);
      if (a?.wallet) {
        setShowEscrow(true);
      } else {
        router.push(loginRedirectEscrow);
      }
    }
  }, [router, loginRedirectEscrow]);

  function handleEscrowClick() {
    if (!isLoggedIn) {
      router.push(loginRedirectEscrow);
      return;
    }
    setShowEscrow(true);
    window.location.hash = "escrow";
    setTimeout(() => {
      document
        .getElementById("escrow-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  async function handleDeposit() {
    const currentAuth = getAuth();
    if (!currentAuth?.wallet) {
      router.push(loginRedirectEscrow);
      return;
    }

    setSigning(true);
    setStatus({ msg: "Signing with passkey...", type: "loading" });

    try {
      // 1. Get passkey assertion for security proof
      const timestamp = Date.now();
      const encoder = new TextEncoder();
      const challengeData = encoder.encode(
        `${listingId}:${currentAuth.wallet}:${minDeposit}:${timestamp}`
      );
      const challenge = new Uint8Array(
        await crypto.subtle.digest("SHA-256", challengeData)
      );

      const allowCredentials: PublicKeyCredentialDescriptor[] = [];
      if (currentAuth.passkey?.credentialId) {
        const rawId = Uint8Array.from(
          atob(currentAuth.passkey.credentialId),
          (c) => c.charCodeAt(0)
        );
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

      setStatus({ msg: "Executing USD transfer...", type: "loading" });

      // 2. Encode USDC transfer transaction
      const USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
      const ESCROW_WALLET_ADDRESS = "0x6C5A9EC44f7979DC959d332Ce2B835301078e68B";

      const transferData = encodeFunctionData({
        abi: [
          {
            name: "transfer",
            type: "function",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ name: "", type: "bool" }],
          },
        ],
        functionName: "transfer",
        args: [ESCROW_WALLET_ADDRESS, BigInt(minDeposit * 1_000_000)], // USDC has 6 decimals - deposit only
      });

      // 3. Send transaction via Privy SDK (client-side execution with gas sponsorship)
      const txResponse = await sendTransaction(
        {
          to: USDC_CONTRACT,
          data: transferData,
          chainId: 84532, // Base Sepolia
        },
        {
          sponsor: true, // Enable gas sponsorship
          uiOptions: {
            showWalletUIs: true,
          },
        }
      );

      console.log("Transaction sent:", txResponse);

      setStatus({ msg: "Recording escrow...", type: "loading" });

      // 4. Send transaction details to server for verification & recording
      const r = await authedFetch("/escrow/deposit", {
        method: "POST",
        body: JSON.stringify({
          listingId,
          depositAmount: minDeposit,
          totalPrice: price,
          transactionHash: txResponse.hash,
          passkey: passkeyData,
        }),
      });

      const d: EscrowDepositResponse & { error?: string } = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to record escrow");

      setStatus(null);
      setDepositResult(d);
      await fetchExistingEscrow();
    } catch (e: unknown) {
      setSigning(false);
      const err = e as Error & { name?: string };
      if (err.name === "NotAllowedError") {
        setStatus({ msg: "Passkey signing cancelled.", type: "error" });
      } else {
        setStatus({ msg: `Failed: ${err.message}`, type: "error" });
      }
    }
  }

  // Short helper for tx hash display
  const shortHash = (hash: string) =>
    `${hash.slice(0, 10)}...${hash.slice(-6)}`;

  // If an escrow already exists, show its status instead of the deposit form
  if (existingEscrow && !loadingEscrow) {
    return (
      <div className="mt-6">
        <EscrowStatusCard escrow={existingEscrow} />
      </div>
    );
  }

  return (
    <>
      {/* Action Buttons */}
      <div className="flex gap-3 mt-6">
        {!loadingEscrow && (
          <button
            onClick={handleEscrowClick}
            className="px-6 py-3 rounded-lg text-base font-semibold bg-brand text-black hover:bg-brand-hover transition-colors cursor-pointer"
          >
            Place Deposit
          </button>
        )}
      </div>

      {/* Escrow Panel */}
      {showEscrow && (
        <div id="escrow-panel" className="mt-8">
          <div className="bg-card border border-white/10 rounded-2xl p-8 max-w-[500px]">
            <h3 className="text-xl font-semibold mb-1">Place Deposit</h3>
            <p className="text-gray-400 text-sm mb-5">
              Hold this Mac Mini with a deposit. Pay the difference when you meet.
            </p>

            <div className="bg-white/3 rounded-lg p-4 mb-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Item</span>
                <span>{itemName}</span>
              </div>
              {category && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Category</span>
                  <span>{category}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">Total Price</span>
                <span className="font-bold">${Number(price).toLocaleString()} USD</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2">
                <span className="text-gray-400">Deposit Now</span>
                <span className="text-brand font-bold">${Number(minDeposit).toLocaleString()} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Pay at Meetup</span>
                <span className="text-gray-300">${Number(price - minDeposit).toLocaleString()} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Network</span>
                <span>Base Sepolia (testnet)</span>
              </div>
            </div>

            <div className="text-sm text-gray-400 mb-4">
              Your wallet:{" "}
              <span className="font-mono text-xs text-success bg-black/30 px-2 py-1 rounded">
                {auth?.wallet}
              </span>
            </div>

            {!depositResult && (
              <button
                onClick={handleDeposit}
                disabled={signing}
                className="w-full py-3.5 mt-3 text-base font-semibold rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Place ${minDeposit} Deposit
              </button>
            )}

            {status && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  status.type === "loading"
                    ? "bg-white/5 text-gray-300"
                    : "bg-error/15 text-error border border-error/30"
                }`}
              >
                {status.type === "loading" && (
                  <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                )}
                {status.msg}
              </div>
            )}

            {depositResult && (
              <div className="mt-4 bg-success/8 border border-success/20 rounded-xl p-5">
                <div className="text-lg font-semibold mb-2">
                  Deposit Placed
                </div>
                <p className="text-gray-400 text-sm mb-3">
                  Your deposit is secured on-chain. The seller has been notified.
                </p>

                <div className="bg-black/20 rounded-lg p-3 space-y-1.5 text-sm mb-3">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Transaction</span>
                    {depositResult.txHash ? (
                      <a
                        href={`${BASESCAN_TX_URL}${depositResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:underline font-mono text-xs"
                      >
                        {shortHash(depositResult.txHash)}
                      </a>
                    ) : (
                      <span className="text-gray-400 text-xs">Confirming...</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Link
                    href={`/escrow/${depositResult.escrowId}`}
                    className="flex-1 text-center py-2 text-sm font-semibold rounded-lg bg-brand text-black hover:bg-brand-hover transition-colors"
                  >
                    View Payment Status
                  </Link>
                </div>

                <p className="text-gray-500 text-xs mt-3">
                  Meet the seller to inspect the Mac Mini. You'll pay the remaining ${price - minDeposit} when you confirm.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// --- Escrow Status Card (shown when an escrow already exists) ---

function EscrowStatusCard({ escrow }: { escrow: Escrow }) {
  const statusColors: Record<string, string> = {
    deposited: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    accepted: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    buyer_confirmed: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    released: "text-success bg-success/10 border-success/20",
    disputed: "text-error bg-error/10 border-error/20",
  };

  const statusLabels: Record<string, string> = {
    deposited: "Awaiting Seller",
    accepted: "Accepted",
    buyer_confirmed: "Buyer Paid",
    released: "Complete",
    disputed: "Disputed",
    cancelled: "Cancelled",
    rejected: "Rejected",
    expired: "Expired",
  };

  return (
    <div className="bg-card border border-white/10 rounded-2xl p-6 max-w-[500px]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Payment Status</h3>
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColors[escrow.status] || "text-gray-400"}`}
        >
          {statusLabels[escrow.status] || escrow.status}
        </span>
      </div>

      <div className="bg-white/3 rounded-lg p-4 space-y-2 text-sm mb-4">
        <div className="flex justify-between">
          <span className="text-gray-400">Total Price</span>
          <span className="font-bold">
            ${Number(escrow.total_price).toLocaleString()} {escrow.currency}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Deposit</span>
          <span className="text-success">
            ${Number(escrow.deposit_amount).toLocaleString()} {escrow.currency}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Remaining</span>
          <span className={escrow.remaining_payment_tx_hash ? "text-success" : "text-gray-300"}>
            ${Number(escrow.remaining_amount).toLocaleString()} {escrow.currency}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Buyer confirmed</span>
          <span className={escrow.buyer_confirmed ? "text-success" : "text-gray-500"}>
            {escrow.buyer_confirmed ? "Yes" : "No"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Seller confirmed</span>
          <span className={escrow.seller_confirmed ? "text-success" : "text-gray-500"}>
            {escrow.seller_confirmed ? "Yes" : "No"}
          </span>
        </div>
        {escrow.deposit_tx_hash && (
          <div className="flex justify-between">
            <span className="text-gray-400">Deposit tx</span>
            <a
              href={`${BASESCAN_TX_URL}${escrow.deposit_tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline font-mono text-xs"
            >
              {escrow.deposit_tx_hash.slice(0, 10)}...
              {escrow.deposit_tx_hash.slice(-6)}
            </a>
          </div>
        )}
        {escrow.release_tx_hash && (
          <div className="flex justify-between">
            <span className="text-gray-400">Release tx</span>
            <a
              href={`${BASESCAN_TX_URL}${escrow.release_tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline font-mono text-xs"
            >
              {escrow.release_tx_hash.slice(0, 10)}...
              {escrow.release_tx_hash.slice(-6)}
            </a>
          </div>
        )}
      </div>

      <Link
        href={`/escrow/${escrow.id}`}
        className="block text-center py-2.5 text-sm font-semibold rounded-lg bg-brand text-black hover:bg-brand-hover transition-colors"
      >
        View Full Details
      </Link>
    </div>
  );
}
