"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

const STORAGE_KEY = "niche-view-mode";

export function useViewMode() {
  const searchParams = useSearchParams();
  const [mode, setModeState] = useState<"human" | "agent">("human");
  const [isHydrated, setIsHydrated] = useState(false);

  // Initialize from URL or localStorage
  useEffect(() => {
    const urlMode = searchParams.get("mode");

    if (urlMode === "agent" || urlMode === "human") {
      setModeState(urlMode);
    } else if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "agent" || stored === "human") {
        setModeState(stored);
      }
    }

    setIsHydrated(true);
  }, [searchParams]);

  const setMode = (newMode: "human" | "agent") => {
    setModeState(newMode);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, newMode);
    }
  };

  return { mode, setMode, isHydrated };
}
