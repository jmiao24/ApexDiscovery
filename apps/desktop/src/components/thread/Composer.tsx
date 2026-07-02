import { useState, type KeyboardEvent } from "react";
import { ArrowUp, Grid2x2, Mic, Plus } from "lucide-react";

/**
 * The "Ask anything" composer. Static mock sessions pass no `onSend`; the live
 * Hermes session passes one to submit prompts to the Gateway.
 */
export function Composer({
  onSend,
  disabled,
  placeholder = "Ask anything",
}: {
  onSend?: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend?.(text);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-card">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full bg-transparent px-1 text-[15px] text-text outline-none placeholder:text-muted"
        aria-label="Ask anything"
      />
      <div className="mt-2 flex items-center gap-1">
        <IconButton label="Add"><Plus size={17} /></IconButton>
        <IconButton label="Tools"><Grid2x2 size={16} /></IconButton>
        <div className="flex-1" />
        <IconButton label="Voice"><Mic size={16} /></IconButton>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-input bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
          onClick={submit}
          disabled={disabled || !value.trim()}
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
