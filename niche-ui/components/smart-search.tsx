"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const SUGGESTIONS = [
  "Charizard under $100",
  "Black Lotus graded PSA 9",
  "Pokemon cards with free shipping",
  "Magic cards from Alpha set",
  "Yu-Gi-Oh Blue-Eyes under $50",
  "Sports cards Michael Jordan rookie",
  "Sealed Pokemon booster boxes",
  "Graded cards only",
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

  // Extract categories
  if (lower.includes("pokemon")) filters.category = "Pokemon";
  if (lower.includes("magic") || lower.includes("mtg"))
    filters.category = "Magic: The Gathering";
  if (lower.includes("yugioh") || lower.includes("yu-gi-oh"))
    filters.category = "Yu-Gi-Oh!";
  if (lower.includes("sports")) filters.category = "Sports Cards";

  // Extract card names (remaining text after filters)
  const nameQuery = query
    .replace(/under \$?\d+/i, "")
    .replace(/over \$?\d+/i, "")
    .replace(/pokemon|magic|yugioh|sports/gi, "")
    .trim();

  if (nameQuery) filters.q = nameQuery;

  return filters;
}
