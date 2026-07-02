import { useState } from "react";
import { ArrowUp, Grid2x2, Mic, Plus } from "lucide-react";

/** The "Ask anything" composer. Static this slice — send is a no-op. */
export function Composer() {
  const [value, setValue] = useState("");
  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-card">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask anything"
        className="w-full bg-transparent px-1 text-[15px] text-text outline-none placeholder:text-muted"
        aria-label="Ask anything"
      />
      <div className="mt-2 flex items-center gap-1">
        <IconButton label="Add"><Plus size={17} /></IconButton>
        <IconButton label="Tools"><Grid2x2 size={16} /></IconButton>
        <div className="flex-1" />
        <IconButton label="Voice"><Mic size={16} /></IconButton>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-input bg-accent text-accent-fg hover:opacity-90"
          aria-label="Send"
        >
          <ArrowUp size={17} />
        </button>
      </div>
    </div>
  );
}

function IconButton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button
      className="flex h-8 w-8 items-center justify-center rounded-input text-muted hover:bg-surface-2 hover:text-text"
      aria-label={label}
    >
      {children}
    </button>
  );
}
