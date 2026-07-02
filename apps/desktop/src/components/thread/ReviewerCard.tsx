import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { FindingLevel, ReviewerBlock } from "@ai4s/shared";
import { cn } from "@/lib/cn";

const BADGE: Record<FindingLevel, { label: string; className: string }> = {
  warn: { label: "Warn", className: "bg-warn/15 text-warn ring-warn/30" },
  ok: { label: "OK", className: "bg-ok/15 text-ok ring-ok/30" },
  error: { label: "Error", className: "bg-error/15 text-error ring-error/30" },
};

export function ReviewerCard({ block }: { block: ReviewerBlock }) {
  const [open, setOpen] = useState(true);
  const count = block.findings.length;
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <button
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ShieldCheck size={16} className="text-muted" />
        <span className="text-sm font-medium text-text">Reviewer</span>
        <span className="text-sm text-muted">
          · {count} finding{count === 1 ? "" : "s"}
        </span>
        <ChevronDown
          size={16}
          className={cn("ml-auto text-muted transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          {block.findings.map((f, i) => {
            const badge = BADGE[f.level];
            return (
              <div key={i} className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-medium ring-1",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="text-sm font-medium text-text">{f.title}</span>
                </div>
                {f.evidence && (
                  <p className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-muted">
                    {f.evidence}
                  </p>
                )}
              </div>
            );
          })}
          {block.note && <p className="text-sm text-muted">{block.note}</p>}
        </div>
      )}
    </div>
  );
}
