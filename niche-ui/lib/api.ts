import { createClient } from "@supabase/supabase-js";

// Use environment variables for Supabase configuration
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const API_BASE = `${SUPABASE_URL}/functions/v1/niche-api`;
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;

/**
 * Create a Supabase client for server-side queries in Server Components.
 * Use this for direct database queries instead of going through edge functions.
 */
export function getSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function apiFetch<T = unknown>(path: string): Promise<T | null> {
  try {
    const res = await fetch(API_BASE + path, {
      cache: "no-store",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** POST/PUT helper that sends JSON body with Supabase anon key headers. */
export async function apiPost<T = unknown>(
  path: string,
  body: unknown
): Promise<{ data: T | null; error: string | null; ok: boolean }> {
  try {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      return { data: null, error: data?.error || "Request failed", ok: false };
    }
    return { data: data as T, error: null, ok: true };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network error",
      ok: false,
    };
  }
}

export const BASESCAN_TX_URL = "https://sepolia.basescan.org/tx/";

export function formatDate(
  dateStr: string,
  opts?: Intl.DateTimeFormatOptions
): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", opts);
  } catch {
    return dateStr;
  }
}
