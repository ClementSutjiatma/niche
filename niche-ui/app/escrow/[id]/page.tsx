import { notFound } from "next/navigation";
import Link from "next/link";
import { apiFetch, formatDate, BASESCAN_TX_URL } from "@/lib/api";
import type { EscrowResponse } from "@/lib/types";
import { EscrowActions } from "./escrow-actions";

export default async function EscrowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await apiFetch<EscrowResponse>(`/escrow/${id}`);

  if (!data?.escrow) notFound();
  const e = data.escrow;
  const listing = e.listings;

  const shortWallet = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "—";

  const statusConfig: Record<
    string,
    { label: string; color: string; icon: string }
  > = {
    deposited: {
      label: "Awaiting Seller",
      color: "text-yellow-400",
      icon: "⏳",
    },
    accepted: {
      label: "Accepted — Arrange Meetup",
      color: "text-blue-400",
      icon: "💬",
    },
    buyer_confirmed: {
      label: "Buyer Confirmed & Paid",
      color: "text-blue-400",
      icon: "✅",
    },
    released: {
      label: "Payment Complete",
      color: "text-success",
      icon: "✅",
    },
    disputed: {
      label: "Disputed",
      color: "text-error",
      icon: "⚠️",
    },
    cancelled: {
      label: "Cancelled",
      color: "text-gray-400",
      icon: "❌",
    },
    rejected: {
      label: "Rejected — Deposit Refunded",
      color: "text-gray-400",
      icon: "❌",
    },
    expired: {
      label: "Expired — Deposit Refunded",
      color: "text-gray-400",
      icon: "⏰",
    },
  };

  const cfg = statusConfig[e.status] || statusConfig.deposited;

  // Build timeline steps for the new flow
  const steps = [
    {
      label: "Deposit Placed",
      done: true,
      detail: `$${e.deposit_amount} USD deposited`,
      txHash: e.deposit_tx_hash,
      time: e.created_at,
    },
    {
      label: "Seller Accepted",
      done: ["accepted", "buyer_confirmed", "released"].includes(e.status),
      detail:
        e.status === "rejected"
          ? "Seller rejected — deposit refunded"
          : e.status === "expired"
            ? "Expired — no seller response"
            : e.accepted_at
              ? "Seller accepted the deposit"
              : "Awaiting seller acceptance",
      time: e.accepted_at,
    },
    {
      label: "Buyer Confirmed & Paid",
      done: ["buyer_confirmed", "released"].includes(e.status),
      detail:
        e.buyer_confirmed && e.remaining_payment_tx_hash
          ? `$${e.remaining_amount} USD paid`
          : "Awaiting buyer confirmation + payment",
      txHash: e.remaining_payment_tx_hash,
      time: e.remaining_payment_confirmed_at,
    },
    {
      label: "Funds Released",
      done: e.status === "released",
      detail: e.release_tx_hash
        ? `$${e.total_price} USD released to seller`
        : e.status === "disputed"
          ? "Disputed — funds held"
          : e.status === "cancelled"
            ? "Cancelled — deposit refunded"
            : "Pending seller confirmation",
      txHash: e.release_tx_hash,
      time: e.confirmed_at,
    },
  ];

  // Determine which states show the actions component
  const activeStates = ["deposited", "accepted", "buyer_confirmed"];

  return (
    <>
      <Link
        href="/escrows"
        className="text-gray-400 text-sm hover:underline"
      >
        ← My Escrows
      </Link>

      {/* Header */}
      <div className="mt-4 mb-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-2xl">{cfg.icon}</span>
          <h1 className={`text-2xl font-bold ${cfg.color}`}>{cfg.label}</h1>
        </div>
        <div className="text-gray-400 text-sm">
          Payment {e.id.slice(0, 8)}
          {listing && (
            <>
              {" "}
              for{" "}
              <Link
                href={`/listing/${e.listing_id}`}
                className="text-brand hover:underline"
              >
                {listing.item_name}
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Details Card */}
      <div className="bg-card border border-white/10 rounded-2xl p-6 max-w-[560px] mb-8">
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Total Price</span>
            <span className="text-brand font-bold text-base">
              ${Number(e.total_price).toLocaleString()} {e.currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Deposit</span>
            <span className="text-success">
              ${Number(e.deposit_amount).toLocaleString()} {e.currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Remaining</span>
            <span className={e.remaining_payment_tx_hash ? "text-success" : "text-gray-300"}>
              ${Number(e.remaining_amount).toLocaleString()} {e.currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Network</span>
            <span>Base Sepolia (testnet)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Created</span>
            <span>
              {formatDate(e.created_at, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          {e.confirmed_at && (
            <div className="flex justify-between">
              <span className="text-gray-400">Completed</span>
              <span>
                {formatDate(e.confirmed_at, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="max-w-[560px] mb-8">
        <h2 className="text-lg font-semibold mb-4">Progress</h2>
        <div className="space-y-0">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div
                  className={`w-3 h-3 rounded-full mt-1 ${
                    step.done
                      ? "bg-success"
                      : e.status === "disputed" && i === 3
                        ? "bg-error"
                        : "bg-gray-600"
                  }`}
                />
                {i < steps.length - 1 && (
                  <div
                    className={`w-0.5 flex-1 min-h-[32px] ${
                      step.done ? "bg-success/40" : "bg-gray-700"
                    }`}
                  />
                )}
              </div>
              <div className="pb-5">
                <div
                  className={`text-sm font-medium ${step.done ? "text-gray-200" : "text-gray-500"}`}
                >
                  {step.label}
                </div>
                {step.detail && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {step.txHash ? (
                      <a
                        href={`${BASESCAN_TX_URL}${step.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:underline font-mono"
                      >
                        {step.txHash.slice(0, 10)}...{step.txHash.slice(-6)}
                      </a>
                    ) : (
                      step.detail
                    )}
                  </div>
                )}
                {step.time && (
                  <div className="text-xs text-gray-600 mt-0.5">
                    {formatDate(step.time, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction Links */}
      {(e.deposit_tx_hash || e.remaining_payment_tx_hash || e.release_tx_hash) && (
        <div className="max-w-[560px] mb-8">
          <h2 className="text-lg font-semibold mb-3">On-Chain Transactions</h2>
          <div className="bg-card border border-white/10 rounded-xl p-4 space-y-2">
            {e.deposit_tx_hash && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Deposit (${e.deposit_amount})</span>
                <a
                  href={`${BASESCAN_TX_URL}${e.deposit_tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline font-mono text-xs"
                >
                  {shortWallet(e.deposit_tx_hash)} ↗
                </a>
              </div>
            )}
            {e.remaining_payment_tx_hash && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Remaining (${e.remaining_amount})</span>
                <a
                  href={`${BASESCAN_TX_URL}${e.remaining_payment_tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline font-mono text-xs"
                >
                  {shortWallet(e.remaining_payment_tx_hash)} ↗
                </a>
              </div>
            )}
            {e.release_tx_hash && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Release (${e.total_price})</span>
                <a
                  href={`${BASESCAN_TX_URL}${e.release_tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline font-mono text-xs"
                >
                  {shortWallet(e.release_tx_hash)} ↗
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions (client component) */}
      {activeStates.includes(e.status) && (
        <EscrowActions escrow={e} />
      )}
    </>
  );
}
