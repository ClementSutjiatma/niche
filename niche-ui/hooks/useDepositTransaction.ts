"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData } from "viem";
import { getAuth } from "@/lib/auth";
import { API_BASE, SUPABASE_ANON_KEY } from "@/lib/api";

interface UseDepositProps {
  listingId: string;
  itemName: string;
  price: number;
  minDeposit: number;
}

export function useDepositTransaction({
  listingId,
  itemName,
  price,
  minDeposit,
}: UseDepositProps) {
  const router = useRouter();
  const { sendTransaction } = useSendTransaction();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [depositResult, setDepositResult] = useState<any>(null);

  const handleDeposit = async () => {
    const auth = getAuth();
    if (!auth?.wallet) {
      router.push(`/login?redirect=${encodeURIComponent(`/listing/${listingId}`)}`);
      return;
    }

    setIsProcessing(true);
    setStatus("Signing with passkey...");
    setError(null);

    try {
      // 1. Passkey challenge
      const timestamp = Date.now();
      const encoder = new TextEncoder();
      const challengeData = encoder.encode(
        `${listingId}:${auth.wallet}:${minDeposit}:${timestamp}`
      );
      const challenge = new Uint8Array(
        await crypto.subtle.digest("SHA-256", challengeData)
      );

      const allowCredentials = auth.passkey?.credentialId
        ? [{
            type: "public-key" as const,
            id: Uint8Array.from(atob(auth.passkey.credentialId), c => c.charCodeAt(0)),
          }]
        : undefined;

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials,
          userVerification: "required",
          timeout: 120000,
        },
      }) as PublicKeyCredential;

      const response = assertion.response as AuthenticatorAssertionResponse;
      const passkeyData = {
        signature: btoa(String.fromCharCode(...new Uint8Array(response.signature))),
        authenticatorData: btoa(String.fromCharCode(...new Uint8Array(response.authenticatorData))),
        clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
      };

      setStatus("Sending USD...");

      // 2. USDC transfer
      const USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
      const ESCROW_WALLET = "0x6C5A9EC44f7979DC959d332Ce2B835301078e68B";

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
        args: [ESCROW_WALLET, BigInt(minDeposit * 1_000_000)],
      });

      const txResponse = await sendTransaction(
        {
          to: USDC_CONTRACT,
          data: transferData,
          chainId: 84532, // Base Sepolia
        },
        { sponsor: true, uiOptions: { showWalletUIs: true } }
      );

      setStatus("Recording escrow...");

      // 3. Record on backend
      const res = await fetch(`${API_BASE}/escrow/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          listingId,
          buyerWallet: auth.wallet,
          buyerUserId: auth.userId || auth.privyUserId,
          depositAmount: minDeposit,
          totalPrice: price,
          transactionHash: txResponse.hash,
          passkey: passkeyData,
          challengeParams: { listingId, wallet: auth.wallet, amount: minDeposit, timestamp },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record escrow");

      setDepositResult(data);
      setStatus(null);
      setIsProcessing(false);

      return data;
    } catch (err: any) {
      setIsProcessing(false);
      setStatus(null);

      if (err.name === "NotAllowedError") {
        setError("Passkey signing cancelled");
      } else {
        setError(err.message || "Deposit failed");
      }

      throw err;
    }
  };

  return {
    handleDeposit,
    status,
    error,
    isProcessing,
    depositResult,
  };
}
