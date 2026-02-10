import Link from "next/link";
import type { Listing } from "@/lib/types";
import { DepositButtonInline } from "./deposit-button-inline";

interface ListingCardProps {
  listing: Listing;
  showDeposit?: boolean;
}

export function ListingCard({ listing, showDeposit = false }: ListingCardProps) {
  const isClaimed = listing.status === "pending";

  return (
    <div className={`bg-surface p-6 flex flex-col h-full ${isClaimed ? "opacity-75" : ""}`}>
      {/* Category + condition + status badges */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {listing.category && (
          <div className="text-xs text-text-tertiary uppercase tracking-wider">
            {listing.category}
          </div>
        )}
        {listing.condition && (
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            listing.condition === 'new' ? 'bg-green-400/10 text-green-400 border-green-400/20' :
            listing.condition === 'like-new' ? 'bg-blue-400/10 text-blue-400 border-blue-400/20' :
            listing.condition === 'good' ? 'bg-text-tertiary/10 text-text-secondary border-text-tertiary/20' :
            'bg-orange-400/10 text-orange-400 border-orange-400/20'
          }`}>
            {listing.condition === 'like-new' ? 'Like New' : listing.condition.charAt(0).toUpperCase() + listing.condition.slice(1)}
          </span>
        )}
        {listing.has_warranty && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-400/10 text-green-400 border border-green-400/20">
            Warranty
          </span>
        )}
        {isClaimed && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
            Claimed
          </span>
        )}
      </div>

      {/* Item name */}
      <Link
        href={`/listing/${listing.id}`}
        className="text-xl font-bold mb-1 hover:text-text-secondary transition-colors no-underline"
      >
        {listing.item_name}
      </Link>

      {/* Specs summary */}
      {(listing.chip || listing.ram || listing.storage) && (
        <div className="text-sm text-text-tertiary mb-3">
          {[listing.chip, listing.ram ? `${listing.ram}GB` : null, listing.storage ? (listing.storage >= 1024 ? `${listing.storage / 1024}TB` : `${listing.storage}GB`) : null].filter(Boolean).join(' · ')}
          {listing.year ? ` · ${listing.year}` : ''}
        </div>
      )}

      {/* Seller X profile */}
      {listing.users?.twitter_username && (
        <a
          href={`https://x.com/${listing.users.twitter_username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors mb-3 no-underline w-fit group"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span>@{listing.users.twitter_username}</span>
        </a>
      )}

      {/* Price */}
      <div className="text-3xl font-bold mb-2">
        ${listing.price.toLocaleString()}
      </div>

      {/* Min deposit */}
      <div className="text-sm text-text-tertiary mb-4">
        Min. deposit: <span className="text-text-primary">${listing.min_deposit}</span>
      </div>

      {/* Description */}
      {listing.item_description && (
        <p className="text-sm text-text-secondary line-clamp-2 mb-4 flex-grow">
          {listing.item_description}
        </p>
      )}

      {/* Actions */}
      <div className="mt-auto space-y-2">
        {isClaimed ? (
          <div className="px-4 py-3 bg-yellow-400/5 border border-yellow-400/20 text-yellow-400 text-sm text-center">
            Deposit placed — pending meetup
          </div>
        ) : (
          showDeposit && listing.users?.id && (
            <DepositButtonInline
              listingId={listing.id}
              itemName={listing.item_name}
              price={listing.price}
              minDeposit={listing.min_deposit}
              category={listing.category}
            />
          )
        )}
        <Link
          href={`/listing/${listing.id}`}
          className="block text-center px-4 py-2 border border-border hover:bg-hover transition-colors text-sm no-underline"
        >
          View Details
        </Link>
      </div>
    </div>
  );
}
