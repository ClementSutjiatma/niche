"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { getAuth, clearAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/authed-api";
import type { AuthState } from "@/lib/types";

export function Nav() {
  const { logout: privyLogout } = usePrivy();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAuth(getAuth());
  }, []);

  // Fetch balance when auth changes
  useEffect(() => {
    if (!auth?.walletId) {
      setBalance(null);
      return;
    }

    const walletId = auth.walletId;
    let mounted = true;
    setLoadingBalance(true);

    async function fetchBalance() {
      try {
        const res = await authedFetch(`/wallet/balance/${walletId}`);
        if (res.ok && mounted) {
          const data = await res.json();
          setBalance(data.balance || "0");
        }
      } catch (err) {
        console.error("Failed to fetch balance:", err);
      } finally {
        if (mounted) setLoadingBalance(false);
      }
    }

    fetchBalance();
    return () => {
      mounted = false;
    };
  }, [auth?.walletId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  const shortWallet = auth?.wallet
    ? `${auth.wallet.slice(0, 6)}...${auth.wallet.slice(-4)}`
    : "";

  return (
    <header className="border-b border-border px-8 py-4 bg-bg">
      <nav className="flex items-center justify-between">
        <Link
          href="/"
          className="text-2xl font-bold text-text-primary hover:text-text-secondary transition-colors"
        >
          niche
        </Link>
        <div className="flex gap-6 text-sm items-center">
          {auth?.wallet ? (
            <>
              {/* Balance Display */}
              {balance !== null && (
                <div className="text-xs text-text-tertiary bg-surface px-3 py-1.5 border border-border">
                  <span className="text-text-tertiary">Balance:</span>{" "}
                  <span className="text-text-primary font-semibold">
                    {loadingBalance ? "..." : `${Number(balance).toLocaleString()} USD`}
                  </span>
                </div>
              )}

              {/* Account Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setOpen(!open)}
                  className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                >
                  Account
                </button>
                {open && (
                  <div className="absolute right-0 top-8 bg-surface border border-border min-w-[220px] z-50 shadow-lg">
                    {/* User Info Section */}
                    <div className="px-4 py-3 border-b border-border">
                      {auth.email && (
                        <div className="text-xs text-text-secondary mb-1">{auth.email}</div>
                      )}
                      <div className="font-mono text-xs text-text-primary">
                        {shortWallet}
                      </div>
                      {balance !== null && (
                        <div className="text-xs text-text-tertiary mt-2">
                          <span className="text-text-tertiary">Balance:</span>{" "}
                          <span className="text-text-primary font-semibold">
                            {Number(balance).toLocaleString()} USD
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Menu Items */}
                    <div className="py-1">
                      <Link
                        href="/account"
                        className="block px-4 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                        onClick={() => setOpen(false)}
                      >
                        My Account
                      </Link>
                      <Link
                        href="/escrows"
                        className="block px-4 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                        onClick={() => setOpen(false)}
                      >
                        My Deposits
                      </Link>
                      <button
                        onClick={async () => {
                          clearAuth();
                          await privyLogout();
                          window.location.href = "/";
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-error hover:bg-hover transition-colors cursor-pointer"
                      >
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link
              href="/login"
              className="text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Login
            </Link>
          )}
      </div>
    </nav>
    </header>
  );
}
