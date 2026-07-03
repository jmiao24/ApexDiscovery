import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ProvenanceRecord } from "@ai4s/shared";
import { listProvenance } from "@/lib/provenance";
import { CodeViewer } from "@/components/code-viewer/CodeViewer";
import { cn } from "@/lib/cn";

/**
 * The provenance History of one artifact: every recorded version with the code
 * that produced it, the tool, the model, and a link back to the originating
 * conversation. Data comes from `.openscience/provenance.jsonl` (P0-3).
 */
export function ProvenancePanel({ path, language }: { path: string; language?: string }) {
  const [records, setRecords] = useState<ProvenanceRecord[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setRecords(null);
    void listProvenance(path).then((r) => {
      if (cancelled) return;
      setRecords([...r].reverse()); // newest first
      setExpanded(r.length > 0 ? r[r.length - 1].version : null);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (records === null) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" /> Loading history…
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="p-4 text-sm text-muted">
        No versions recorded yet. Each time the agent writes{" "}
        <span className="font-mono text-text">{path}</span>, a version is added here with the
        code, model, and conversation that produced it.
      </div>
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {records.map((r) => {
        const open = expanded === r.version;
        return (
          <li key={r.version} className="rounded-input border border-border bg-surface">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              onClick={() => setExpanded(open ? null : r.version)}
              aria-expanded={open}
            >
              {open ? (
                <ChevronDown size={14} className="shrink-0 text-muted" />
              ) : (
                <ChevronRight size={14} className="shrink-0 text-muted" />
              )}
              <span className="rounded bg-surface-2 px-1.5 text-xs font-medium text-text">
                v{r.version}
              </span>
              <span className="font-mono text-xs text-muted">{r.tool}</span>
              <span className="flex-1" />
              <span className="text-xs text-muted">{formatTs(r.ts)}</span>
            </button>
            {open && (
              <div className="space-y-2 border-t border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {r.model && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{r.model}</span>
                  )}
                  {r.log && <span className="truncate">{r.log}</span>}
                  <span className="flex-1" />
                  {r.sessionId && (
                    <button
                      className="flex items-center gap-1 text-link hover:underline"
                      onClick={() => navigate(`/live/${r.sessionId}`)}
                      title="Open the conversation this version came from"
                    >
                      <MessageSquare size={12} /> Open conversation
                    </button>
                  )}
                </div>
                {r.content ? (
                  <CodeViewer code={r.content} language={language} />
                ) : (
                  <div className={cn("text-xs text-muted")}>
                    Content not captured for this version (binary or produced by running code).
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
