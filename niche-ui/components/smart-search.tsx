"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const SUGGESTIONS = [
  "M4 Pro under $1500",
  "Mac Mini with 64GB RAM",
  "M4 Max new in box",
  "M2 under $500",
  "48GB with warranty",
  "M1 good condition",
  "M4 Pro 1TB storage",
  "Like-new M4 under $700",
];

export function SmartSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [placeholder, setPlaceholder] = useState(SUGGESTIONS[0]);

  // Rotate placeholder suggestions every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholder((prev) => {
        const idx = SUGGESTIONS.indexOf(prev);
        return SUGGESTIONS[(idx + 1) % SUGGESTIONS.length];
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Parse natural language into filters
    const filters = parseNaturalLanguage(query);
    const params = new URLSearchParams(filters);
    router.push(`/?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSearch} className="w-full max-w-3xl mx-auto">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full px-6 py-4 bg-surface border border-border text-text-primary placeholder:text-text-tertiary text-lg focus:outline-none focus:border-text-secondary transition-colors"
        />
        <button
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2 bg-text-primary text-bg hover:bg-text-secondary transition-colors font-medium"
        >
          Search
        </button>
      </div>
    </form>
  );
}

// Parse natural language queries into structured filters
function parseNaturalLanguage(query: string): Record<string, string> {
  const filters: Record<string, string> = {};
  const lower = query.toLowerCase();

  // Extract price ranges
  const underMatch = lower.match(/under \$?(\d+)/);
  if (underMatch) filters.max_price = underMatch[1];

  const overMatch = lower.match(/over \$?(\d+)/);
  if (overMatch) filters.min_price = overMatch[1];

  // Extract categories (chip families — match longest first)
  if (lower.includes("m4 max")) filters.category = "M4 Max";
  else if (lower.includes("m4 pro")) filters.category = "M4 Pro";
  else if (lower.includes("m4")) filters.category = "M4";
  else if (lower.includes("m2 max")) filters.category = "M2 Max";
  else if (lower.includes("m2 pro")) filters.category = "M2 Pro";
  else if (lower.includes("m2")) filters.category = "M2";
  else if (lower.includes("m1 pro")) filters.category = "M1 Pro";
  else if (lower.includes("m1")) filters.category = "M1";

  // Extract item names (remaining text after filters)
  const nameQuery = query
    .replace(/under \$?\d+/i, "")
    .replace(/over \$?\d+/i, "")
    .replace(/m[124]\s*(pro|max)?/gi, "")
    .replace(/mac\s*mini/gi, "")
    .trim();

  if (nameQuery) filters.q = nameQuery;

  return filters;
}
