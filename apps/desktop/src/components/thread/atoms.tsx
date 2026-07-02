import { Loader2 } from "lucide-react";
import type {
  DataTableBlock,
  RunningJobsBlock,
  StatusLineBlock,
  UserMessageBlock,
} from "@ai4s/shared";
import { cn } from "@/lib/cn";
import { MarkdownViewer } from "@/components/markdown-viewer/MarkdownViewer";

export function UserMessage({ block }: { block: UserMessageBlock }) {
  return (
    <div className="rounded-card bg-surface-2 px-4 py-3 text-[15px] leading-relaxed text-text">
      {block.text}
    </div>
  );
}

export function AgentMessage({ markdown }: { markdown: string }) {
  return <MarkdownViewer>{markdown}</MarkdownViewer>;
}

export function DataTable({ block }: { block: DataTableBlock }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
      {block.caption && (
        <div className="border-b border-border px-4 py-2 text-xs text-muted">{block.caption}</div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            {block.columns.map((c) => (
              <th key={c} className="px-4 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-4 py-2 text-text",
                    j === row.length - 1 && "font-mono text-[13px] text-link",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunningJobsOverlay({ block }: { block: RunningJobsBlock }) {
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted">
        {block.title}
      </div>
      <ul className="divide-y divide-border/60">
        {block.jobs.map((j, i) => (
          <li key={i} className="flex items-center gap-2 px-4 py-2 text-sm">
            <Loader2 size={13} className="animate-spin text-accent" />
            <span className="flex-1 truncate text-text">{j.label}</span>
            <span className="text-xs text-muted">{j.elapsed}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TONE: Record<NonNullable<StatusLineBlock["tone"]>, string> = {
  running: "text-accent",
  done: "text-ok",
  review: "text-muted",
};

export function StatusLine({ block }: { block: StatusLineBlock }) {
  return (
    <div className={cn("flex items-center gap-2 text-sm", TONE[block.tone ?? "review"])}>
      <Loader2
        size={14}
        className={cn(block.tone === "running" && "animate-spin", block.tone !== "running" && "hidden")}
      />
      <span>{block.text}</span>
    </div>
  );
}
