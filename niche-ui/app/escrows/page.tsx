import { EscrowsClient } from "./escrows-client";

export default function EscrowsPage() {
  // This page needs the user's ID from localStorage (client-side auth).
  // We use a client wrapper to get the auth state and fetch escrows.
  return <EscrowsClient />;
}
