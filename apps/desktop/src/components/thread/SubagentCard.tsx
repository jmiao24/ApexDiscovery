import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronRight, ExternalLink, Loader2, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ThreadBlock, ToolCallBlock } from "@ai4s/shared";
import { cn } from "@/lib/cn";
import { Elapsed, ToolGroup } from "./ToolGroup";
import { STATUS } from "./ToolCallRow";

function durationLabel(start?: number, end?: number): string | null {
  if (start === undefined || end === undefined) return null;
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function toolLabel(tool: string): string {
  switch (tool) {
    case "websearch": return "Web Search";
    case "webfetch": return "Web Fetch";
    case "execute_code": return "ExecuteCode";
    case "bash": return "Bash";
    case "read": return "Read";
    case "write": return "Write";
    case "edit": return "Edit";
    case "grep": return "Grep";
    case "glob": return "Glob";
    case "mcp": return "MCP";
    default: return tool;
  }
}

export function SubagentCard({
  block,
  activity,
  trace,
  onOpen,
  onCancel,
}: {
  block: ToolCallBlock;
  activity?: string;
  trace?: ThreadBlock[];
  onOpen?: (childSessionId: string) => void;
  onCancel?: (childSessionId: string) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const running = block.status === "running" || block.status === "pending";
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [autoOpen, setAutoOpen] = useState(running);
  useEffect(() => {
    if (running) setAutoOpen(true);
  }, [running]);
  const open = userOpen ?? autoOpen;
  const traceTools = useMemo(
    () => (trace ?? []).filter((item): item is ToolCallBlock => item.kind === "tool-call"),
    [trace],
  );
  const skills = useMemo(() => [...new Set([
    ...(block.subagentSkills ?? []),
    ...traceTools.flatMap((item) => item.tool === "skill" && item.skillName ? [item.skillName] : []),
  ])], [block.subagentSkills, traceTools]);
  const tools = useMemo(() => [...new Set([
    ...(block.subagentTools ?? []),
    ...traceTools.flatMap((item) => item.tool && item.tool !== "skill" ? [toolLabel(item.tool)] : []),
  ])], [block.subagentTools, traceTools]);
  const status = STATUS[block.status];
  const duration = durationLabel(block.startedAt, block.endedAt);
  const childId = block.childSessionId!;

  return (
    <section
      className="overflow-hidden rounded-[20px] border border-faint bg-[var(--activity-surface)] shadow-sm"
      data-subagent-card
      data-status={block.status}
    >
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-link"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-faint bg-bg text-text shadow-sm">
          {running ? <Loader2 size={17} className="animate-spin text-accent" /> : <Bot size={17} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium text-text">
              {block.subagentName || t("live.subagent.literatureAgent")}
            </span>
            <span className={cn("flex shrink-0 items-center gap-1 text-xs", status.className)}>
              {status.icon}
              {t(`live.subagent.status.${block.status}`)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {running ? activity || block.title : block.title}
          </span>
        </span>
        {running && block.startedAt !== undefined ? <Elapsed start={block.startedAt} /> : duration && (
          <span className="shrink-0 font-mono text-[11px] text-muted">{duration}</span>
        )}
        <ChevronRight
          size={16}
          className={cn("shrink-0 text-muted transition-transform duration-200", open && "rotate-90")}
        />
      </button>

      {open && (
        <div className="border-t border-faint px-5 pb-4 pt-4">
          {block.subagentTask && (
            <div className="rounded-[14px] border border-faint bg-bg/60 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                {t("live.subagent.assignedTask")}
              </div>
              <p className="mt-1.5 text-sm leading-6 text-text">{block.subagentTask}</p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className="rounded-full border border-faint bg-bg/60 px-2.5 py-1">
              {block.subagentSandbox === "danger-full-access"
                ? t("live.subagent.fullAccess")
                : t("live.subagent.approveMode")}
            </span>
            <span className="rounded-full border border-faint bg-bg/60 px-2.5 py-1">
              {t("live.subagent.noNestedAgents")}
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                {t("live.subagent.tools")}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tools.map((tool) => (
                  <span key={tool} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text">{tool}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                <span>{t("live.subagent.skills")}</span>
                {block.subagentAvailableSkillCount !== undefined && (
                  <span className="normal-case tracking-normal">
                    {t("live.subagent.availableSkills", { count: block.subagentAvailableSkillCount })}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {skills.length ? skills.map((skill) => (
                  <span key={skill} className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-xs text-text">
                    ${skill}
                  </span>
                )) : (
                  <span className="text-xs text-muted">{t("live.subagent.noLoadedSkills")}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-faint pt-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
              {t("live.subagent.activity")}
            </div>
            {traceTools.length ? (
              <ToolGroup blocks={traceTools} />
            ) : (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
                {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
                <span>{activity || t("live.subagent.waitingForActivity")}</span>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 border-t border-faint pt-3">
            {running && onCancel && (
              <button
                type="button"
                onClick={() => onCancel(childId)}
                className="flex items-center gap-1.5 rounded-full border border-faint px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
              >
                <Square size={11} fill="currentColor" />
                {t("live.subagent.cancel")}
              </button>
            )}
            {onOpen && (
              <button
                type="button"
                onClick={() => onOpen(childId)}
                className="flex items-center gap-1.5 rounded-full bg-text px-3 py-1.5 text-xs text-bg hover:opacity-90"
              >
                <ExternalLink size={12} />
                {t("live.subagent.openSession")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
