import { AlertTriangle, Check, Clock, Loader2, ShieldQuestion, X } from "lucide-react";
import type { ToolCallBlock, ToolCallStatus } from "@ai4s/shared";
import { cn } from "@/lib/cn";

const STATUS: Record<
  ToolCallStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  pending: { label: "Pending", icon: <Clock size={14} />, className: "text-muted" },
  running: { label: "Running", icon: <Loader2 size={14} className="animate-spin" />, className: "text-accent" },
  "waiting-approval": { label: "Waiting", icon: <ShieldQuestion size={14} />, className: "text-warn" },
  success: { label: "Success", icon: <Check size={14} />, className: "text-ok" },
  warning: { label: "Warning", icon: <AlertTriangle size={14} />, className: "text-warn" },
  failed: { label: "Failed", icon: <X size={14} />, className: "text-error" },
};

export function ToolCallRow({ block }: { block: ToolCallBlock }) {
  const s = STATUS[block.status];
  return (
    <div
      className="flex items-center gap-2 rounded-input border border-border bg-surface px-3 py-2.5 text-sm"
      data-status={block.status}
    >
      <span className={cn("shrink-0", s.className)} aria-label={s.label} role="img">
        {s.icon}
      </span>
      <span className="flex-1 truncate text-text">{block.title}</span>
      {block.meta && <span className="shrink-0 text-xs text-muted">{block.meta}</span>}
    </div>
  );
}
