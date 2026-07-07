import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  FileOutput,
  FileCode2,
  Loader2,
  MessageSquare,
  Package,
  RotateCcw,
  ScrollText,
} from "lucide-react";
import type { RunArtifact, RunRecord } from "@ai4s/shared";
import { listRuns, readRunLog, reproduceRunPrompt } from "@/lib/runs";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/cn";

/**
 * Every recorded experiment run in this workspace — its reproducibility recipe.
 * Reads `.openscience/runs.jsonl` (newest first). A run is one execution that
 * produced results; each shows the command, code version, environment +
 * hardware, and outputs, and can draft a Reproduce prompt (re-run + compare).
 */
export function RunsPage() {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // The captured log currently shown, keyed by its content hash; loaded lazily.
  const [log, setLog] = useState<{ hash: string; text: string | null } | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);

  const toggleLog = (hash: string) => {
    if (log?.hash === hash) {
      setLog(null);
      return;
    }
    setLog({ hash, text: null });
    void readRunLog(hash).then((text) =>
      setLog((cur) => (cur?.hash === hash ? { hash, text: text ?? "(log unavailable)" } : cur)),
    );
  };

  useEffect(() => {
    let cancelled = false;
    void listRuns().then((r) => {
      if (cancelled) return;
      setRuns(r);
      // A deep link (?run=…) from an artifact opens that run; else the newest.
      const target = searchParams.get("run");
      const open = target && r.some((x) => x.runId === target) ? target : r[0]?.runId;
      setExpanded(open ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  // Draft the recipe into the conversation the run came from — reviewed, sent
  // by the user (human in the loop, never auto-run).
  const reproduce = (r: RunRecord) => {
    setComposerDraft(reproduceRunPrompt(r));
    navigate(r.sessionId ? `/live/${r.sessionId}` : "/live");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="font-serif text-xl text-text">Runs</h1>
        <p className="mt-1 text-sm text-muted">
          Every experiment execution recorded in this workspace — the command, code version,
          environment, hardware, and outputs. Reproduce re-runs it and compares the results.
        </p>

        {runs === null && (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Loading runs…
          </div>
        )}

        {runs && runs.length === 0 && (
          <div className="mt-6 rounded-input border border-border bg-surface p-4 text-sm text-muted">
            No runs recorded yet. When the agent runs code (e.g.{" "}
            <span className="font-mono text-text">python train.py</span>), each execution is recorded
            here with its reproducibility recipe.
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {runs?.map((r) => {
            const open = expanded === r.runId;
            return (
              <li key={r.runId} className="rounded-input border border-border bg-surface">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
                  onClick={() => setExpanded(open ? null : r.runId)}
                  aria-expanded={open}
                >
                  {open ? (
                    <ChevronDown size={14} className="shrink-0 text-muted" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-muted" />
                  )}
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      r.status === "ok" ? "bg-ok" : "bg-error",
                    )}
                    title={r.status === "ok" ? "Succeeded" : "Failed"}
                  />
                  <span className="flex-1 truncate font-mono text-xs text-text">{r.command}</span>
                  {r.surface && r.surface !== "local" && (
                    <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted ring-1 ring-border">
                      {r.surface}
                    </span>
                  )}
                  {r.wallMs != null && (
                    <span className="shrink-0 text-xs text-muted">{formatDuration(r.wallMs)}</span>
                  )}
                  <span className="shrink-0 text-xs text-muted">{formatTs(r.ts)}</span>
                </button>

                {open && (
                  <div className="space-y-2.5 border-t border-border px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {r.env && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">
                          {[r.env.python && `py ${r.env.python}`, r.env.platform, `app ${r.env.app}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                      {r.env?.hardware && (
                        <span
                          className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 font-mono"
                          title="Hardware this run executed on"
                        >
                          <Cpu size={11} />
                          {hardwareLabel(r.env.hardware)}
                        </span>
                      )}
                      {r.env?.packages && (
                        <span className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 font-mono">
                          <Package size={11} /> {r.env.packages.count} packages
                        </span>
                      )}
                      <span className="flex-1" />
                      {r.logHash && (
                        <button
                          className={cn(
                            "flex items-center gap-1 hover:text-text hover:underline",
                            log?.hash === r.logHash ? "text-text" : "text-link",
                          )}
                          onClick={() => toggleLog(r.logHash!)}
                          aria-pressed={log?.hash === r.logHash}
                          title="View the captured stdout/stderr"
                        >
                          <ScrollText size={12} /> Log
                        </button>
                      )}
                      <button
                        className="flex items-center gap-1 text-link hover:underline"
                        onClick={() => reproduce(r)}
                        title="Draft a prompt that re-runs this command and compares the outputs"
                      >
                        <RotateCcw size={12} /> Reproduce
                      </button>
                      {r.sessionId && (
                        <button
                          className="flex items-center gap-1 text-link hover:underline"
                          onClick={() => navigate(`/live/${r.sessionId}`)}
                          title="Open the conversation this run came from"
                        >
                          <MessageSquare size={12} /> Open conversation
                        </button>
                      )}
                    </div>

                    {r.code.length > 0 && (
                      <FileGroup icon={<FileCode2 size={12} />} label="Code" files={r.code} />
                    )}
                    {r.outputs.length > 0 && (
                      <FileGroup icon={<FileOutput size={12} />} label="Outputs" files={r.outputs} />
                    )}
                    {r.outputs.length === 0 && r.surface && r.surface !== "local" && (
                      <div className="text-xs text-muted">
                        Ran on {r.surface === "hpc" ? "an HPC cluster" : r.surface} — outputs live off
                        this machine and weren't captured locally.
                      </div>
                    )}

                    {r.logHash && log?.hash === r.logHash && (
                      <div className="rounded-input border border-border bg-surface-2">
                        <div className="border-b border-border px-2.5 py-1 text-[11px] text-muted">
                          stdout / stderr
                        </div>
                        {log.text === null ? (
                          <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted">
                            <Loader2 size={12} className="animate-spin" /> Loading…
                          </div>
                        ) : (
                          <pre className="max-h-64 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text">
                            {log.text}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function FileGroup({ icon, label, files }: { icon: React.ReactNode; label: string; files: RunArtifact[] }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted">
        {icon} {label}
      </div>
      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={f.path} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate font-mono text-text">{f.path}</span>
            <span className="shrink-0 text-muted">{humanSize(f.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function hardwareLabel(hw: NonNullable<RunRecord["env"]>["hardware"]): string {
  if (!hw) return "";
  if (hw.gpu && hw.gpu.length > 0) return hw.gpu.join(", ");
  return [hw.cpu, hw.accelerator].filter(Boolean).join(" · ");
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
