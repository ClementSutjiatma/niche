"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { BASESCAN_TX_URL, formatDate } from "@/lib/api";
import { authedFetch } from "@/lib/authed-api";
import type { Escrow } from "@/lib/types";

const statusConfig: Record<
  string,
  { label: string; badgeClass: string }
> = {
  deposited: {
    label: "Awaiting Seller",
    badgeClass: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  },
  accepted: {
    label: "Accepted",
    badgeClass: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  },
  buyer_confirmed: {
    label: "Buyer Paid",
    badgeClass: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  },
  released: {
    label: "Released",
    badgeClass: "text-success bg-success/10 border-success/20",
  },
  disputed: {
    label: "Disputed",
    badgeClass: "text-error bg-error/10 border-error/20",
  },
  cancelled: {
    label: "Cancelled",
    badgeClass: "text-gray-400 bg-gray-400/10 border-gray-400/20",
  },
  rejected: {
    label: "Rejected",
    badgeClass: "text-gray-400 bg-gray-400/10 border-gray-400/20",
  },
  expired: {
    label: "Expired",
    badgeClass: "text-gray-400 bg-gray-400/10 border-gray-400/20",
  },
};

export function EscrowsClient() {
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const auth = getAuth();

  useEffect(() => {
    if (!auth?.userId) {
      setLoading(false);
      return;
    }

    async function fetchEscrows() {
      try {
        const res = await authedFetch("/escrows", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch escrows");
        const data = await res.json();
        setEscrows(data.escrows || []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchEscrows();
  }, [auth?.userId]);

  if (!auth?.wallet) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold mb-3">My Escrows</h1>
        <p className="text-gray-400 mb-4">
          Log in to view your escrow transactions.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2.5 rounded-lg text-sm font-semibold bg-brand text-black hover:bg-brand-hover transition-colors"
        >
          Login
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-16 text-center">
        <div className="inline-block w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-gray-400 text-sm">Loading escrows...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-error text-sm">{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Escrows</h1>
        <span className="text-gray-500 text-sm">
          {escrows.length} escrow{escrows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {escrows.length === 0 ? (
        <div className="text-center py-16 bg-card border border-white/10 rounded-2xl">
          <p className="text-gray-400 mb-3">No escrows yet.</p>
          <Link
            href="/"
            className="text-brand hover:underline text-sm"
          >
            Browse listings to get started
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {escrows.map((e) => {
            const isBuyer = e.buyer_id === auth.userId;
            const role = isBuyer ? "Buyer" : "Seller";
            const cfg = statusConfig[e.status] || statusConfig.deposited;
            const listing = e.listings;
            const confirms = `${e.buyer_confirmed ? "✓" : "○"}/${e.seller_confirmed ? "✓" : "○"}`;

            return (
              <Link
                key={e.id}
                href={`/escrow/${e.id}`}
                className="block bg-card border border-white/10 rounded-xl p-4 hover:border-white/20 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.badgeClass}`}
                    >
                      {cfg.label}
                    </span>
                    <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                      {role}
                    </span>
                  </div>
                  <span className="text-brand font-bold">
                    ${Number(e.total_price).toLocaleString()} {e.currency}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="text-gray-400">
                    {listing
                      ? `${listing.item_name} (${listing.category || 'Mac Mini'})`
                      : `Listing ${e.listing_id.slice(0, 8)}`}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span title="Buyer/Seller confirmations">
                      {confirms}
                    </span>
                    <span>
                      {formatDate(e.created_at, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                </div>

                {e.deposit_tx_hash && (
                  <div className="mt-2 text-xs text-gray-600 font-mono">
                    tx: {e.deposit_tx_hash.slice(0, 14)}...
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
