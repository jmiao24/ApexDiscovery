import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Loader2, Wrench } from "lucide-react";
import hljs from "highlight.js/lib/common";
import { useTranslation } from "react-i18next";
import type { ThreadBlock, ToolCallBlock } from "@ai4s/shared";
import i18n from "@/i18n";
import { cn } from "@/lib/cn";
import { DiffView } from "@/components/code-viewer/DiffView";
import { STATUS } from "./ToolCallRow";

// Codex-style tool activity: consecutive quiet tool steps fold into one
// summary line ("Ran 3 commands, created a file"); expanding shows the list;
// expanding a step shows its detail (shell output, diff, file content)
// inline. Active groups open so the user can follow the natural-language
// action list, while each step's code/output stays folded until clicked.

export type BlockListItem =
  | { kind: "group"; start: number; blocks: ToolCallBlock[] }
  | { kind: "block"; index: number; block: ThreadBlock };

/** Fold runs of tool-call blocks into groups. Failures stay IN the group —
 *  an agent trying, failing, and adjusting is routine, and a card per failed
 *  fetch would drown the thread (the group summary counts them instead).
 *  Only a step that needs the USER (waiting-approval) or a non-tool block
 *  breaks the run and renders on its own. Pure — exported for tests. */
export function groupToolBlocks(blocks: ThreadBlock[]): BlockListItem[] {
  const items: BlockListItem[] = [];
  let group: { start: number; blocks: ToolCallBlock[] } | null = null;
  const flush = () => {
    if (group) items.push({ kind: "group", start: group.start, blocks: group.blocks });
    group = null;
  };
  blocks.forEach((b, i) => {
    // Reviewer orchestration is a first-class phase boundary, not another
    // low-level tool hidden inside "Ran N commands". Keep Review/Fix/Re-review
    // visible in the timeline while their own bash/MCP steps can still fold.
    const workflowPhase = b.kind === "tool-call" && (
      b.tool === "task" || b.tool === "reviewer" || b.tool === "fix"
    );
    if (workflowPhase) {
      flush();
      items.push({ kind: "block", index: i, block: b });
    } else if (b.kind === "tool-call" && b.status !== "waiting-approval") {
      group ??= { start: i, blocks: [] };
      group.blocks.push(b);
    } else {
      flush();
      items.push({ kind: "block", index: i, block: b });
    }
  });
  flush();
  return items;
}

/** "Ran 3 commands, created a file" — one phrase per verb, in first-seen order. */
export function summarizeGroup(blocks: ToolCallBlock[]): string {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    const verb = b.verb ?? "";
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
  }
  const phrase = (verb: string, n: number): string => {
    switch (verb) {
      case "Ran":
        return i18n.t("session:tool.group.phrase.ran", { count: n });
      case "Created":
        return i18n.t("session:tool.group.phrase.created", { count: n });
      case "Edited":
        return i18n.t("session:tool.group.phrase.edited", { count: n });
      case "Read":
        return i18n.t("session:tool.group.phrase.read", { count: n });
      case "Searched":
        return i18n.t("session:tool.group.phrase.searched", { count: n });
      case "Listed":
        return i18n.t("session:tool.group.phrase.listed");
      case "Fetched":
        return i18n.t("session:tool.group.phrase.fetched", { count: n });
      default:
        return i18n.t("session:tool.group.phrase.default", { count: n });
    }
  };
  const text = [...counts.entries()].map(([verb, n]) => phrase(verb, n)).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

/** Ticking elapsed time for a running step ("2m 41s"). */
export function Elapsed({ start }: { start: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
      {fmtDuration(Date.now() - start)}
    </span>
  );
}

/** Smooth expand/collapse without measuring content (grid-rows 0fr→1fr).
 *  Closed content is NOT mounted — a history session can hold a hundred tool
 *  steps whose details total megabytes of text; mounting them all up front
 *  makes opening the session jank. Opening mounts collapsed and expands on
 *  the next frame (so the animation still runs); closing unmounts after the
 *  transition finishes. */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = window.requestAnimationFrame(() => setShown(true));
      return () => window.cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 300);
    return () => window.clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-300 ease-out",
        shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

const PANE =
  "whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs leading-5";

const HIGHLIGHT_LANGUAGE: Record<string, string> = {
  py: "python",
  python3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
};

function escapeCode(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Bash grammars leave a simple `command /path arg` invocation unclassified.
 *  Give those otherwise-plain commands useful editor color without guessing
 *  at shell semantics: command token, path tokens, and flags only. */
function highlightPlainShell(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      let commandSeen = false;
      return (line.match(/\s+|\S+/g) ?? []).map((token) => {
        if (/^\s+$/.test(token)) return token;
        const escaped = escapeCode(token);
        if (!commandSeen) {
          commandSeen = true;
          return `<span class="hljs-built_in">${escaped}</span>`;
        }
        if (/^(?:\.{0,2}\/|~\/)/.test(token)) {
          return `<span class="hljs-string">${escaped}</span>`;
        }
        if (/^--?[A-Za-z0-9]/.test(token)) {
          return `<span class="hljs-attribute">${escaped}</span>`;
        }
        return escaped;
      }).join("");
    })
    .join("\n");
}

function SyntaxInput({
  code,
  language,
  shell = false,
}: {
  code: string;
  language: string;
  shell?: boolean;
}) {
  const html = useMemo(() => {
    const requested = HIGHLIGHT_LANGUAGE[language] ?? language;
    try {
      const highlighted = hljs.getLanguage(requested)
        ? hljs.highlight(code, { language: requested }).value
        : hljs.highlightAuto(code).value;
      return requested === "bash" && !highlighted.includes('class="hljs-')
        ? highlightPlainShell(code)
        : highlighted;
    } catch {
      return escapeCode(code);
    }
  }, [code, language]);

  return (
    <pre
      className={cn(
        PANE,
        "max-h-80 overflow-y-auto rounded-[12px] border border-faint bg-bg px-4 py-3 text-text",
      )}
      data-execute-code-input={!shell ? true : undefined}
      data-shell-command={shell ? true : undefined}
    >
      <code
        className="apex-syntax-highlight"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}

/** Last few lines of a running command's stdout — the "it's alive" signal. */
function LiveTail({ text }: { text: string }) {
  const tail = text.replace(/\s+$/, "").split("\n").slice(-8).join("\n");
  if (!tail) return null;
  return (
    <pre className={cn(PANE, "ml-7 mb-1 mt-0.5 rounded-input bg-surface-2 text-muted")}>{tail}</pre>
  );
}

/** Disposable shell detail: the same calm input/output hierarchy as REPL. */
function BashDetail({ block }: { block: ToolCallBlock }) {
  const out = block.output ?? block.outputSummary;
  return (
    <div
      className="ml-7 mb-2 mt-1 overflow-hidden rounded-[16px] border border-faint bg-surface-2 shadow-sm"
      data-bash-detail
    >
      <div className="flex items-center justify-between border-b border-faint px-4 py-2 text-[11px] font-medium tracking-[0.12em] text-muted">
        <span>SHELL</span>
        <span className="normal-case tracking-normal">{block.tool}</span>
      </div>
      {block.command && (
        <div className={cn("px-3 pb-3 pt-3", out && "border-b border-faint")}>
          <div className="px-1 pb-2 text-[11px] font-medium tracking-[0.1em] text-muted">COMMAND</div>
          <SyntaxInput code={block.command} language="bash" shell />
        </div>
      )}
      {out && (
        <div className="px-3 pb-3 pt-3">
          <div className="px-1 pb-2 text-[11px] font-medium tracking-[0.1em] text-muted">STDOUT</div>
          <pre className={cn(PANE, "max-h-80 overflow-y-auto rounded-[12px] border border-faint bg-bg px-4 py-3 text-text")}>
            {out}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Reproducible code detail: source and persisted execution result. */
function ExecuteCodeDetail({ block }: { block: ToolCallBlock }) {
  const language = (block.language || "python").toLowerCase();
  const runtimeLabel = language === "python" ? "REPL" : language.toUpperCase();
  return (
    <div
      className="ml-7 mb-2 mt-1 overflow-hidden rounded-[16px] border border-faint bg-surface-2 shadow-sm"
      data-execute-code-detail
    >
      <div className="flex items-center justify-between border-b border-faint px-4 py-2 text-[11px] font-medium tracking-[0.12em] text-muted">
        <span>{runtimeLabel}</span>
        <span className="normal-case tracking-normal">{language}</span>
      </div>
      {block.command && (
        <div className={cn("px-3 pb-3 pt-3", block.output && "border-b border-faint")}>
          <div className="px-1 pb-2 text-[11px] font-medium tracking-[0.1em] text-muted">INPUT</div>
          <SyntaxInput code={block.command} language={language} />
        </div>
      )}
      {block.output && (
        <div className="px-3 pb-3 pt-3">
          <div className="px-1 pb-2 text-[11px] font-medium tracking-[0.1em] text-muted">STDOUT</div>
          <pre
            className={cn(PANE, "max-h-80 overflow-y-auto rounded-[12px] border border-faint bg-bg px-4 py-3 text-text")}
            data-execute-code-output
          >
            {block.output}
          </pre>
        </div>
      )}
    </div>
  );
}

const researchDuration = (milliseconds: number) =>
  milliseconds < 1000 ? `${Math.max(0, Math.round(milliseconds))}ms` : `${(milliseconds / 1000).toFixed(1)}s`;

/** Built-in Codex search events retain their exact query. APEX WebSearch and
 * WebFetch add an evidence summary and complete, clickable source metadata. */
function WebSearchDetail({ block }: { block: ToolCallBlock }) {
  const { t } = useTranslation("session");
  const result = block.webResult;
  const query = result?.query || result?.url || block.query || block.title;
  const url = /^https?:\/\/\S+$/i.test(query.trim()) ? query.trim() : null;
  const isFetch = result?.kind === "fetch" || block.tool === "webfetch";
  const sourceCount = result?.resultCount ?? result?.sources.length ?? 0;
  return (
    <div
      className="ml-7 mb-2 mt-1 overflow-hidden rounded-[16px] border border-faint bg-surface-2 shadow-sm"
      data-web-search-detail
      data-web-research-detail
    >
      <div className="flex items-center justify-between gap-3 border-b border-faint px-4 py-2 text-[11px] font-medium tracking-[0.12em] text-muted">
        <span>{t(isFetch ? "tool.detail.webFetch" : "tool.detail.webSearch")}</span>
        {result && (
          <span className="normal-case tracking-normal">
            {t("tool.detail.sourceCount", { count: sourceCount })} · {researchDuration(result.durationMs)}
          </span>
        )}
      </div>
      <div className="px-3 pb-3 pt-3">
        <div className="px-1 pb-2 text-[11px] font-medium tracking-[0.1em] text-muted">
          {url ? t("tool.detail.url") : t("tool.detail.query")}
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 break-all rounded-[12px] border border-faint bg-bg px-4 py-3 font-mono text-xs leading-5 text-link hover:underline"
          >
            <span>{url}</span>
            <ExternalLink size={12} className="shrink-0" />
          </a>
        ) : (
          <pre className={cn(PANE, "rounded-[12px] border border-faint bg-bg px-4 py-3 text-text")}>
            {query}
          </pre>
        )}
      </div>
      {result?.answer && (
        <div className="border-t border-faint px-3 pb-3 pt-3">
          <div className="px-1 pb-2 text-[11px] font-medium tracking-[0.1em] text-muted">
            {t("tool.detail.summary")}
          </div>
          <div className="whitespace-pre-wrap rounded-[12px] border border-faint bg-bg px-4 py-3 text-sm leading-6 text-text">
            {result.answer}
          </div>
        </div>
      )}
      {result && result.sources.length > 0 && (
        <div className="border-t border-faint px-3 pb-3 pt-3">
          <div className="px-1 pb-2 text-[11px] font-medium tracking-[0.1em] text-muted">
            {t("tool.detail.sources")}
          </div>
          <div className="space-y-2">
            {result.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-[12px] border border-faint bg-bg px-4 py-3 transition-colors hover:border-muted"
              >
                <span className="flex items-start justify-between gap-3 text-sm font-medium text-link">
                  <span>{source.title}</span>
                  <ExternalLink size={13} className="mt-0.5 shrink-0" />
                </span>
                <span className="mt-1 block break-all font-mono text-[11px] leading-4 text-muted">
                  {source.url}
                </span>
                {source.context && (
                  <span className="mt-2 block text-xs leading-5 text-muted">{source.context}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffDetail({ diff }: { diff: string }) {
  return <DiffView diff={diff} className="ml-7 mb-1 mt-0.5 max-h-64 overflow-y-auto" />;
}

function TextDetail({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <pre
      className={cn(
        PANE,
        "ml-7 mb-1 mt-0.5 max-h-64 overflow-y-auto rounded-input bg-surface-2",
        muted ? "text-muted" : "text-text",
      )}
    >
      {text}
    </pre>
  );
}

function detailFor(block: ToolCallBlock): React.ReactNode | null {
  if (block.tool === "bash") {
    return block.command || block.output || block.outputSummary ? (
      <BashDetail block={block} />
    ) : null;
  }
  if (block.tool === "execute_code") {
    return block.command || block.output ? <ExecuteCodeDetail block={block} /> : null;
  }
  if (block.tool === "websearch" || block.tool === "webfetch") {
    return block.webResult || block.query || block.title ? <WebSearchDetail block={block} /> : null;
  }
  if (block.diff) return <DiffDetail diff={block.diff} />;
  if (block.content) return <TextDetail text={block.content} />;
  if (block.output) return <TextDetail text={block.output} />;
  return null;
}

function ToolRow({
  block,
  activity,
  trace,
  activityFor,
  traceFor,
  onSubagentOpen,
  onOpen,
}: {
  block: ToolCallBlock;
  activity?: string;
  trace?: ThreadBlock[];
  activityFor?: (childSessionId: string) => string | undefined;
  traceFor?: (childSessionId: string) => ThreadBlock[] | undefined;
  onSubagentOpen?: (childSessionId: string) => void;
  onOpen?: (block: ToolCallBlock) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const s = STATUS[block.status];
  const running = block.status === "running";
  // While running the live tail is already on screen — the row only becomes
  // expandable once there is a settled detail to reveal.
  const opensInspector = !!onOpen && (
    block.tool === "skill" || (block.tool === "execute_code" && !!block.notebookPath)
  );
  const detail = running || opensInspector ? null : detailFor(block);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen === true && !!detail;
  const interactive = opensInspector || !!detail;
  const done = block.startedAt !== undefined && block.endedAt !== undefined;
  const duration = done ? block.endedAt! - block.startedAt! : 0;
  const failureLines = (block.outputSummary ?? block.output)?.trim().split("\n").filter(Boolean);
  const failureSummary = block.status === "failed" && failureLines?.length
    ? failureLines[failureLines.length - 1]
    : undefined;
  const traceTools = (trace ?? []).filter(
    (item): item is ToolCallBlock => item.kind === "tool-call",
  );
  const latestTrace = [...(trace ?? [])]
    .reverse()
    .find((item) => item.kind === "tool-call" || item.kind === "agent");
  const traceHasRunningTool = traceTools.some(
    (item) => item.status === "running" || item.status === "pending",
  );
  const showActivityPulse = Boolean(
    activity && running && !traceHasRunningTool && (traceTools.length === 0 || latestTrace?.kind === "agent"),
  );
  return (
    <div data-status={block.status}>
      <div
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={opensInspector ? () => onOpen(block) : detail ? () => setUserOpen(!open) : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (opensInspector) onOpen(block);
                  else setUserOpen(!open);
                }
              }
            : undefined
        }
        className={cn(
          "group flex min-h-10 items-center gap-3 rounded-[12px] px-3 py-2 text-[14px]",
          interactive && "cursor-pointer hover:bg-black/[0.035] dark:hover:bg-white/[0.035]",
        )}
      >
        <span className={cn("shrink-0", block.tool === "skill" ? "text-accent" : s.className)} aria-label={t(`tool.status.${block.status}`)} role="img">
          {block.tool === "skill" && !running ? <Wrench size={15} /> : s.icon}
        </span>
        {block.verb && !block.naturalTitle && (
          <span className="shrink-0 text-muted">{t(`tool.verb.${block.verb}`)}</span>
        )}
        <span
          className={cn("min-w-0 truncate", running ? "text-text" : "text-muted")}
          title={block.command ?? block.title}
        >
          {block.title}
        </span>
        {interactive && (
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 text-muted transition-transform duration-200",
              open && !opensInspector && "rotate-90",
              !opensInspector && !open && "opacity-0 group-hover:opacity-100",
            )}
          />
        )}
        <span className="min-w-0 flex-1" />
        {running && block.startedAt !== undefined && <Elapsed start={block.startedAt} />}
        {!running && done && (duration >= 1000 || block.tool === "skill") && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
            {fmtDuration(duration)}
          </span>
        )}
        {(block.meta || failureSummary) && (
          <span
            className={cn(
              "max-w-[46%] shrink truncate text-right text-sm text-muted",
              failureSummary && "text-error/80",
            )}
            title={failureSummary ?? block.meta}
          >
            {failureSummary ?? block.meta}
          </span>
        )}
      </div>
      {/* A spawned child keeps its full tool trace beneath the parent task.
          The trace remains after completion; long traces use the same nested
          collapsible grouping and detail panels as Main Agent tool calls. */}
      {block.childSessionId && (traceTools.length > 0 || showActivityPulse || onSubagentOpen) && (
        <div className="ml-[14px] border-l border-border pl-2" data-subagent-trace>
          {traceTools.length > 0 && (
            <ToolGroup
              blocks={traceTools}
              activityFor={activityFor}
              traceFor={traceFor}
              onSubagentOpen={onSubagentOpen}
              onToolOpen={onOpen}
            />
          )}
          {showActivityPulse && (
            <div className="flex items-center gap-2 px-2 py-0.5 text-xs" data-subagent-activity>
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-muted">{activity}</span>
            </div>
          )}
          {onSubagentOpen && (
            <button
              type="button"
              onClick={() => onSubagentOpen(block.childSessionId!)}
              className="flex items-center gap-1.5 rounded-input px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
            >
              <ExternalLink size={12} />
              <span>{t("live.subagent.openSession")}</span>
            </button>
          )}
        </div>
      )}
      {/* A running tail is visible only after its containing group is opened. */}
      {running && block.partialOutput && <LiveTail text={block.partialOutput} />}
      {detail && <Collapse open={open}>{detail}</Collapse>}
    </div>
  );
}

export function ToolGroup({
  blocks,
  activityFor,
  traceFor,
  onSubagentOpen,
  onToolOpen,
}: {
  blocks: ToolCallBlock[];
  activityFor?: (childSessionId: string) => string | undefined;
  traceFor?: (childSessionId: string) => ThreadBlock[] | undefined;
  onSubagentOpen?: (childSessionId: string) => void;
  onToolOpen?: (block: ToolCallBlock) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  // Once activity starts, keep the outer action list visible without opening
  // any individual step's code/output detail. A click still overrides the
  // group state; settled history starts folded unless the group had a failure.
  const active = blocks.some((b) => b.status === "running" || b.status === "pending");
  const failed = blocks.filter((b) => b.status === "failed" || b.status === "warning").length;
  const [autoOpen, setAutoOpen] = useState(active || failed > 0);
  useEffect(() => {
    if (active || failed > 0) setAutoOpen(true);
  }, [active, failed]);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? autoOpen;
  const rows = blocks.map((b, i) => (
    <ToolRow
      key={i}
      block={b}
      activity={b.childSessionId ? activityFor?.(b.childSessionId) : undefined}
      trace={b.childSessionId ? traceFor?.(b.childSessionId) : undefined}
      activityFor={activityFor}
      traceFor={traceFor}
      onSubagentOpen={onSubagentOpen}
      onOpen={onToolOpen}
    />
  ));
  if (blocks.length === 1) return <div>{rows}</div>;
  return (
    <div className="overflow-hidden rounded-[18px] bg-[var(--activity-surface)]">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 px-5 py-4 text-left text-[15px] text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-link"
      >
        {active ? (
          <Loader2 size={18} className="shrink-0 animate-spin text-accent" />
        ) : (
          <ChevronRight
            size={18}
            className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")}
          />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{summarizeGroup(blocks)}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted">
          {t("stepSummary.steps", { count: blocks.length })}
        </span>
      </button>
      <Collapse open={open}>
        <div className="border-t border-faint px-3 py-2">{rows}</div>
      </Collapse>
    </div>
  );
}
