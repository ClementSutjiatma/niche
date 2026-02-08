"use client";

interface SearchFormProps {
  action: string;
  neighborhood?: string;
  maxPrice?: string;
  minRooms?: string;
  centered?: boolean;
}

export function SearchForm({
  action,
  neighborhood = "",
  maxPrice = "",
  minRooms = "",
  centered = false,
}: SearchFormProps) {
  return (
    <form
      action={action}
      method="GET"
      className={`flex flex-wrap gap-3 mb-6 items-end ${centered ? "justify-center" : ""}`}
    >
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Neighborhood
        </label>
        <input
          type="text"
          name="neighborhood"
          defaultValue={neighborhood}
          placeholder="East Village, Bushwick..."
          className="bg-white/6 border border-white/12 text-gray-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-brand w-[200px]"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Max Price</label>
        <input
          type="number"
          name="max_price"
          defaultValue={maxPrice}
          placeholder="3000"
          className="bg-white/6 border border-white/12 text-gray-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-brand w-[120px]"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Min Rooms</label>
        <input
          type="number"
          name="min_rooms"
          defaultValue={minRooms}
          placeholder="1"
          className="bg-white/6 border border-white/12 text-gray-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-brand w-[80px]"
        />
      </div>
      <div>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand text-black hover:bg-brand-hover transition-colors cursor-pointer"
        >
          Search
        </button>
      </div>
    </form>
  );
}
