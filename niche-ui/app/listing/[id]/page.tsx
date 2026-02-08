import { notFound } from "next/navigation";
import Link from "next/link";
import { getSupabaseClient, formatDate } from "@/lib/api";
import type { ListingDetail } from "@/lib/types";
import { ListingActions } from "./listing-actions";

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = getSupabaseClient();
  const { data: listing, error } = await supabase
    .from("listings")
    .select("*, users(id, display_name, channel_id, channel_type, wallet_address, twitter_username, twitter_user_id)")
    .eq("id", id)
    .single();

  if (error || !listing) notFound();
  const l = listing as ListingDetail;

  const listerName =
    l.users?.display_name || l.users?.channel_id || "Anonymous";
  const listerWallet = l.users?.wallet_address || "";
  const shortWallet = listerWallet
    ? `${listerWallet.slice(0, 6)}...${listerWallet.slice(-4)}`
    : "";

  return (
    <>
      <Link href="/" className="text-gray-400 text-sm hover:underline">
        ← Back to listings
      </Link>

      <div className="mt-4 mb-6">
        <div className="flex items-center gap-2">
          <div className="text-sm text-gray-400 uppercase tracking-wide">
            {l.category ? `${l.category} Card` : 'Trading Card'}
          </div>
          {l.status === "pending" && (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
              Claimed
            </span>
          )}
        </div>
        <div className="text-3xl font-bold">
          {l.item_name}
        </div>
        <div className="text-2xl font-bold text-brand mt-2">
          ${Number(l.price).toLocaleString()} USD
        </div>
        <div className="text-gray-400 text-sm mt-2">
          Min. deposit: <span className="text-brand font-semibold">${Number(l.min_deposit).toLocaleString()} USD</span>
        </div>
      </div>

      <div className="text-base text-gray-300 leading-relaxed my-4 p-4 bg-white/3 rounded-lg">
        {l.item_description || "No description provided."}
      </div>

      <div className="text-sm text-gray-500 mt-4 pt-4 border-t border-white/6">
        {l.users?.twitter_username && (
          <div className="mt-2">
            <a
              href={`https://x.com/${l.users.twitter_username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all no-underline group"
            >
              <svg className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span className="text-sm text-gray-300 group-hover:text-white transition-colors">@{l.users.twitter_username}</span>
            </a>
          </div>
        )}
        {shortWallet && (
          <>
            <br />
            <small className="text-gray-600">Wallet: {shortWallet}</small>
          </>
        )}
      </div>

      <ListingActions
        listingId={id}
        itemName={l.item_name}
        price={l.price}
        minDeposit={l.min_deposit}
        category={l.category}
        sellerUserId={l.user_id || ""}
      />
    </>
  );
}
