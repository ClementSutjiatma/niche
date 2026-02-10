"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { SUPABASE_URL, SUPABASE_ANON_KEY, formatDate } from "@/lib/api";
import { authedFetch } from "@/lib/authed-api";
import type { Escrow, Watch, AuthState } from "@/lib/types";

type Tab = "escrows" | "watches";

const statusConfig: Record<string, { label: string; badgeClass: string }> = {
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
};

export function AccountClient() {
  const [tab, setTab] = useState<Tab>("escrows");
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loadingEscrows, setLoadingEscrows] = useState(true);
  const [loadingWatches, setLoadingWatches] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const auth = getAuth();

  useEffect(() => {
    if (!auth?.userId) {
      setLoadingEscrows(false);
      setLoadingWatches(false);
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
        setLoadingEscrows(false);
      }
    }

    async function fetchWatches() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/watches?user_id=eq.${auth!.userId}&order=created_at.desc`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
          }
        );
        if (!res.ok) throw new Error("Failed to fetch watches");
        const data = await res.json();
        setWatches(data || []);
      } catch (e) {
        console.error("Failed to fetch watches:", e);
      } finally {
        setLoadingWatches(false);
      }
    }

    fetchEscrows();
    fetchWatches();
  }, [auth?.userId]);

  if (!auth?.wallet) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold mb-3">My Account</h1>
        <p className="text-gray-400 mb-4">
          Log in to view your escrows and watches.
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

  const shortWallet = `${auth.wallet.slice(0, 6)}...${auth.wallet.slice(-4)}`;
  const [copied, setCopied] = useState(false);

  const copyWallet = useCallback(() => {
    navigator.clipboard.writeText(auth.wallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [auth.wallet]);

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">My Account</h1>
        <div className="flex items-center gap-3 text-sm text-gray-400">
          {auth.email && <span>{auth.email}</span>}
          <button
            onClick={copyWallet}
            title="Copy wallet address"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-success bg-white/5 px-2 py-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
          >
            {shortWallet}
            {copied ? (
              <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-white/10">
        <button
          onClick={() => setTab("escrows")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
            tab === "escrows"
              ? "text-brand border-b-2 border-brand"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Escrows
          {!loadingEscrows && (
            <span className="ml-1.5 text-xs text-gray-500">
              ({escrows.length})
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("watches")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
            tab === "watches"
              ? "text-brand border-b-2 border-brand"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Watches
          {!loadingWatches && (
            <span className="ml-1.5 text-xs text-gray-500">
              ({watches.length})
            </span>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="py-4 text-center">
          <p className="text-error text-sm">{error}</p>
        </div>
      )}

      {/* Escrows Tab */}
      {tab === "escrows" && (
        <EscrowsList
          escrows={escrows}
          loading={loadingEscrows}
          auth={auth}
        />
      )}

      {/* Watches Tab */}
      {tab === "watches" && (
        <WatchesList watches={watches} loading={loadingWatches} />
      )}
    </>
  );
}

function EscrowsList({
  escrows,
  loading,
  auth,
}: {
  escrows: Escrow[];
  loading: boolean;
  auth: AuthState;
}) {
  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="inline-block w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-gray-400 text-sm">Loading escrows...</p>
      </div>
    );
  }

  if (escrows.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-white/10 rounded-2xl">
        <p className="text-gray-400 mb-3">No escrows yet.</p>
        <Link href="/" className="text-brand hover:underline text-sm">
          Browse listings to get started
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {escrows.map((e) => {
        const isBuyer = e.buyer_id === auth.userId;
        const role = isBuyer ? "Buyer" : "Seller";
        const cfg = statusConfig[e.status] || statusConfig.deposited;
        const listing = e.listings;
        const confirms = `${e.buyer_confirmed ? "\u2713" : "\u25CB"}/${e.seller_confirmed ? "\u2713" : "\u25CB"}`;

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
                <span title="Buyer/Seller confirmations">{confirms}</span>
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
  );
}

function WatchesList({
  watches,
  loading,
}: {
  watches: Watch[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="inline-block w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-gray-400 text-sm">Loading watches...</p>
      </div>
    );
  }

  if (watches.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-white/10 rounded-2xl">
        <p className="text-gray-400 mb-3">No watches yet.</p>
        <p className="text-gray-500 text-sm">
          Use the CLI to create a watch:{" "}
          <code className="bg-white/5 px-1.5 py-0.5 rounded text-xs text-gray-300">
            niche watch --category &quot;Pokemon&quot;
          </code>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {watches.map((w) => {
        const cats = w.categories?.length
          ? w.categories.join(", ")
          : "Any category";

        return (
          <div
            key={w.id}
            className="bg-card border border-white/10 rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full border text-info bg-info/10 border-info/20">
                  Watching
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  {w.id.slice(0, 8)}
                </span>
              </div>
              <span className="text-xs text-gray-500">
                {formatDate(w.created_at, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            <div className="text-sm text-gray-300 mb-1">{cats}</div>

            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>
                Max: {w.max_price ? `$${w.max_price.toLocaleString()}` : "Any"}
              </span>
              <span>
                Min Deposit: {w.min_deposit ? `$${w.min_deposit.toLocaleString()}` : "Any"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
