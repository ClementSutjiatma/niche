import type { AuthState } from "./types";

const AUTH_KEY = "niche_auth";

export function getAuth(): AuthState | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveAuth(state: AuthState): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(state));
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY);
}
