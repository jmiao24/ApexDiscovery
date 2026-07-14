import { Clock3, Wrench, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SkillInspector as SkillInspectorT } from "@ai4s/shared";
import { PaneTitlebarInset } from "./RightPane";

function duration(start?: number, end?: number): string | null {
  if (start === undefined || end === undefined) return null;
  const ms = Math.max(0, end - start);
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function SkillInspector({
  data,
  onClose,
  controls,
}: {
  data: SkillInspectorT;
  onClose: () => void;
  controls?: React.ReactNode;
}) {
  const { t } = useTranslation(["inspector", "common"]);
  const elapsed = duration(data.startedAt, data.endedAt);
  const input = JSON.stringify(
    { action: "load", name: data.name, source: data.source, path: data.path },
    null,
    2,
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <PaneTitlebarInset />
        <Wrench size={15} className="shrink-0 text-accent" />
        <span className="truncate text-sm font-medium text-text">
          {t("skill.title", { name: data.name })}
        </span>
        <div className="flex-1" />
        {controls}
        <button className="text-text hover:opacity-60" aria-label={t("shell.closeInspector")} onClick={onClose}>
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 font-medium text-accent">
            <Wrench size={12} /> {t("skill.badge")}
          </span>
          {elapsed && (
            <span className="inline-flex items-center gap-1 text-muted">
              <Clock3 size={12} /> {elapsed}
            </span>
          )}
          <span className="rounded-full bg-surface-2 px-2 py-1 text-muted">
            {t("skill.source", { source: data.source })}
          </span>
        </div>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{t("skill.input")}</h2>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-card border border-border bg-surface-2 p-3 font-mono text-xs leading-5 text-text">
            {input}
          </pre>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{t("skill.output")}</h2>
          <pre className="max-h-none overflow-x-auto whitespace-pre-wrap break-words rounded-card border border-border bg-surface-2 p-4 font-mono text-xs leading-5 text-text">
            {data.content}
          </pre>
        </section>
      </div>
    </div>
  );
}
