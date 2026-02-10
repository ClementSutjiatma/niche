/**
 * Authenticated API helpers.
 *
 * Uses Privy JWT (from getAccessToken()) as the Authorization header
 * instead of the old Supabase anon key pattern.
 *
 * Usage:
 *   1. In providers.tsx, call registerTokenGetter(getAccessToken) on mount.
 *   2. Import authedFetch / authedPost from this module for all authenticated API calls.
 *   3. The user identity is derived server-side from the JWT — no more walletAddress in bodies.
 */

import { API_BASE } from "./api";

let _getToken: (() => Promise<string | null>) | null = null;

/** Called once from AuthRegistrar to register the Privy token getter. */
export function registerTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

/** Authenticated fetch — includes Privy JWT in Authorization header. */
export async function authedFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const token = _getToken ? await _getToken() : null;
  if (!token) {
    throw new Error("Not authenticated — no Privy token available");
  }

  return fetch(API_BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}

/** Authenticated POST — returns parsed response. */
export async function authedPost<T = unknown>(
  path: string,
  body: unknown
): Promise<{ data: T | null; error: string | null; ok: boolean }> {
  try {
    const res = await authedFetch(path, {
      method: "POST",
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

/** Authenticated GET — returns parsed response. */
export async function authedGet<T = unknown>(
  path: string
): Promise<{ data: T | null; error: string | null; ok: boolean }> {
  try {
    const res = await authedFetch(path, { method: "GET" });
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
