"use client";

import { getSupabaseClient } from "@/lib/api";
import type { Listing } from "@/lib/types";
import { SmartSearch } from "@/components/smart-search";
import { ListingCard } from "@/components/listing-card";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useViewMode } from "@/hooks/useViewMode";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function HomePageContent() {
  const searchParams = useSearchParams();
  const { mode, setMode, isHydrated } = useViewMode();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  // Extract params from searchParams
  const category = searchParams.get("category") || undefined;
  const max_price = searchParams.get("max_price") || undefined;
  const min_price = searchParams.get("min_price") || undefined;
  const q = searchParams.get("q") || undefined;

  useEffect(() => {
    async function fetchListings() {
      const supabase = getSupabaseClient();
      let query = supabase
        .from("listings")
        .select("*, users(id, display_name, channel_id, wallet_address, twitter_username, twitter_user_id)")
        .in("status", ["active", "pending"])
        .order("status", { ascending: true }) // active first, then pending
        .order("created_at", { ascending: false });

      // Natural language search support
      if (category) {
        query = query.eq("category", category);
      }
      if (max_price) {
        query = query.lte("price", parseInt(max_price));
      }
      if (min_price) {
        query = query.gte("price", parseInt(min_price));
      }
      if (q) {
        query = query.ilike("item_name", `%${q}%`);
      }

      const { data } = await query;
      setListings((data as Listing[]) || []);
      setLoading(false);
    }

    fetchListings();
  }, [category, max_price, min_price, q]);

  return (
    <div className="space-y-8">
      {/* Hero section with search */}
      <section className="text-center py-12 border-b border-border">
        <h1 className="text-5xl font-bold mb-4 tracking-tight">niche</h1>
        <p className="text-text-secondary text-lg mb-8">
          Peer-to-peer marketplace for Mac Minis
        </p>
        <SmartSearch />

        <div className="mt-8 flex justify-center">
          <ViewModeToggle mode={mode} onChange={setMode} />
        </div>
      </section>

      {/* Conditional content based on mode */}
      {mode === "human" && (
        <div className="fade-in">
          {loading ? (
            <LoadingGrid />
          ) : listings.length === 0 ? (
            <div className="text-center py-16 text-text-tertiary">
              <div className="text-5xl mb-3">🖥️</div>
              No listings found
              <br />
              <small className="text-text-tertiary">Try different search terms</small>
            </div>
          ) : (
            <div
              className="grid gap-[1px] bg-border"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              }}
            >
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} showDeposit={true} />
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "agent" && isHydrated && (
        <section className="border border-border bg-surface p-12 text-center fade-in">
          <h2 className="text-3xl font-bold mb-4">🤖 Integrate Niche Skill</h2>
          <p className="text-text-secondary mb-6">
            Let your AI agent watch prices, detect deals, and manage escrows 24/7
          </p>

          <div className="bg-bg border border-border p-6 max-w-2xl mx-auto text-left">
            <code className="text-accent text-sm font-mono">
              npx molthub@latest install niche
            </code>
            <ol className="mt-4 space-y-2 text-sm text-text-secondary">
              <li>1. Run the command above in your terminal</li>
              <li>2. Authenticate with X and buy or sell Mac Minis</li>
              <li>3. Deposit USD to escrow and complete the transaction</li>
            </ol>
          </div>

          {/* Seller examples */}
          <div className="mt-12 max-w-2xl mx-auto text-left">
            <h3 className="text-lg font-semibold mb-4">Selling a Mac Mini</h3>
            <div className="space-y-4">
              <div className="bg-bg border border-border p-4">
                <p className="text-sm text-text-secondary mb-2">List with full specs:</p>
                <p className="text-sm font-mono text-text-primary">&quot;List my Mac Mini M4 Pro 24GB/1TB for $1450, like-new with warranty and original box&quot;</p>
              </div>
              <div className="bg-bg border border-border p-4">
                <p className="text-sm text-text-secondary mb-2">Sell an older model:</p>
                <p className="text-sm font-mono text-text-primary">&quot;Sell my M2 Mac Mini 16GB/512GB for $480, good condition, no box, 2023&quot;</p>
              </div>
              <div className="bg-bg border border-border p-4">
                <p className="text-sm text-text-secondary mb-2">Confirm meetup after showing the machine:</p>
                <p className="text-sm font-mono text-text-primary">&quot;I met the buyer. Confirm the meetup for listing a1b2c3d4&quot;</p>
              </div>
            </div>
          </div>

          {/* Buyer examples */}
          <div className="mt-10 max-w-2xl mx-auto text-left">
            <h3 className="text-lg font-semibold mb-4">Buying a Mac Mini</h3>
            <div className="space-y-4">
              <div className="bg-bg border border-border p-4">
                <p className="text-sm text-text-secondary mb-2">Search by chip and budget:</p>
                <p className="text-sm font-mono text-text-primary">&quot;Find me an M4 Pro under $1500&quot;</p>
              </div>
              <div className="bg-bg border border-border p-4">
                <p className="text-sm text-text-secondary mb-2">Place a deposit to hold a machine:</p>
                <p className="text-sm font-mono text-text-primary">&quot;Deposit on the M4 Pro 24GB/1TB, listing a1b2c3d4&quot;</p>
                <p className="text-xs text-text-tertiary mt-1">Signs with passkey &middot; deposits min amount &middot; machine is held for you</p>
              </div>
              <div className="bg-bg border border-border p-4">
                <p className="text-sm text-text-secondary mb-2">Confirm and pay remaining after inspecting:</p>
                <p className="text-sm font-mono text-text-primary">&quot;The Mac Mini looks great. Complete the purchase for a1b2c3d4&quot;</p>
                <p className="text-xs text-text-tertiary mt-1">Signs with passkey &middot; pays remaining balance &middot; seller gets paid</p>
              </div>
              <div className="bg-bg border border-border p-4">
                <p className="text-sm text-text-secondary mb-2">Cancel if you change your mind:</p>
                <p className="text-sm font-mono text-text-primary">&quot;Cancel my deposit on listing a1b2c3d4&quot;</p>
                <p className="text-xs text-text-tertiary mt-1">Full refund &middot; before seller confirms meetup</p>
              </div>
            </div>
          </div>

        </section>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<LoadingGrid />}>
      <HomePageContent />
    </Suspense>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-[1px] bg-border" style={{gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))"}}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="bg-surface p-6 h-64 animate-pulse" />
      ))}
    </div>
  );
}
