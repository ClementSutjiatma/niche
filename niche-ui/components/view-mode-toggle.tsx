"use client";

interface ViewModeToggleProps {
  mode: "human" | "agent";
  onChange: (mode: "human" | "agent") => void;
}

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  return (
    <div className="inline-flex bg-surface border border-border">
      <button
        onClick={() => onChange("human")}
        className={`px-6 py-2 text-sm font-medium transition-colors ${
          mode === "human"
            ? "bg-bg text-text-primary border-r border-border"
            : "text-text-secondary hover:bg-hover"
        }`}
        aria-selected={mode === "human"}
        role="tab"
      >
        Human
      </button>
      <button
        onClick={() => onChange("agent")}
        className={`px-6 py-2 text-sm font-medium transition-colors ${
          mode === "agent"
            ? "bg-bg text-text-primary"
            : "text-text-secondary hover:bg-hover"
        }`}
        aria-selected={mode === "agent"}
        role="tab"
      >
        Agent
      </button>
    </div>
  );
}
