export interface Listing {
  id: string;
  item_name: string;
  price: number;
  min_deposit: number;
  item_description?: string;
  category?: string;
  status?: 'active' | 'pending' | 'sold' | 'cancelled';
  user_id?: string;
  created_at?: string;
  users?: ListingUser; // Joined user data
}

export interface ListingUser {
  id?: string; // Added for deposit functionality
  display_name?: string;
  channel_id?: string;
  wallet_address?: string;
  twitter_username?: string;
  twitter_user_id?: string;
}

export interface ListingDetail extends Listing {
  user_id?: string;
  users?: ListingUser;
}

export interface ListingsResponse {
  listings: Listing[];
}

export interface ListingResponse {
  listing: ListingDetail;
}

export interface AuthState {
  privyUserId?: string;
  email?: string;
  wallet: string;
  walletId?: string;
  userId?: string;
  twitterUsername?: string;
  passkey?: {
    publicKey: string;
    credentialId: string;
  };
  balance?: string;
}

// --- Escrow types ---

export type EscrowStatus = "deposited" | "accepted" | "buyer_confirmed" | "released" | "disputed" | "cancelled" | "rejected" | "expired";

export interface Escrow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  deposit_amount: number;
  total_price: number;
  remaining_amount: number;
  currency: string;
  escrow_service: "onchain" | "simulated";
  escrow_id?: string;
  status: EscrowStatus;
  buyer_confirmed: boolean;
  seller_confirmed: boolean;
  deposit_tx_hash?: string;
  remaining_payment_tx_hash?: string;
  remaining_payment_confirmed_at?: string;
  release_tx_hash?: string;
  confirmed_at?: string;
  accepted_at?: string;
  expires_at?: string;
  created_at: string;
  listings?: Listing;
  buyer?: { id?: string; wallet_address?: string; twitter_username?: string; display_name?: string };
  seller?: { id?: string; wallet_address?: string; twitter_username?: string; display_name?: string };
}

export interface EscrowMessage {
  id: string;
  body: string;
  sender_id: string;
  created_at: string;
}

export interface EscrowResponse {
  escrow: Escrow;
}

export interface EscrowsResponse {
  escrows: Escrow[];
}

export interface EscrowDepositResponse {
  escrowId: string;
  txHash?: string; // May not be available immediately (async transactions)
  transactionId?: string; // Privy transaction ID
  userOperationHash?: string; // Privy user operation hash
}

// --- Watch types ---

export interface Watch {
  id: string;
  user_id: string;
  categories: string[] | null;
  max_price: number | null;
  min_deposit: number | null;
  created_at: string;
}
