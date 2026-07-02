import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import type { ArtifactInspector as ArtifactInspectorT, ArtifactTab } from "@ai4s/shared";
import { cn } from "@/lib/cn";
import { CodeViewer } from "@/components/code-viewer/CodeViewer";

const TABS: ArtifactTab[] = ["Code", "Execution Log", "Messages", "Environment", "Review"];

export function ArtifactInspector({
  data,
  onClose,
}: {
  data: ArtifactInspectorT;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ArtifactTab>("Code");

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="truncate text-sm font-medium text-text">{data.title}</span>
        <div className="ml-2 flex items-center gap-1 text-muted">
          <ChevronLeft size={15} />
          <span className="rounded bg-surface-2 px-1.5 text-xs">{data.activeVersion}</span>
          <ChevronRight size={15} />
        </div>
        <div className="flex-1" />
        <button className="text-muted hover:text-text" aria-label="Download">
          <Download size={16} />
        </button>
        <button className="text-muted hover:text-text" aria-label="Close inspector" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <nav className="flex items-center gap-4 border-b border-border px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center gap-1 border-b-2 py-2.5 text-sm",
              tab === t
                ? "border-accent text-text"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {t}
            {t === "Review" && data.reviewPassed && <Check size={13} className="text-ok" />}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "Code" && (
          <div className="space-y-3">
            <button className="flex items-center gap-2 rounded-input bg-link px-3 py-1.5 text-sm font-medium text-white">
              <Download size={15} /> Download script
            </button>
            {data.inputs.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Inputs</span>
                {data.inputs.map((f) => (
                  <span
                    key={f}
                    className="rounded-input bg-surface-2 px-2 py-1 font-mono text-xs text-text ring-1 ring-border"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
            <CodeViewer code={data.code} language={data.language} startLine={data.codeStartLine} />
          </div>
        )}
        {tab === "Execution Log" && <Pre text={data.executionLog ?? "No execution log."} />}
        {tab === "Messages" && (
          <ul className="space-y-2">
            {(data.messages ?? []).map((m, i) => (
              <li key={i} className="rounded-input bg-surface-2 px-3 py-2 text-sm text-text">
                {m}
              </li>
            ))}
          </ul>
        )}
        {tab === "Environment" && <Pre text={data.environment ?? "No environment info."} />}
        {tab === "Review" && (
          <div className="flex items-center gap-2 text-sm text-ok">
            <Check size={16} /> Review passed — figure traces to code and inputs.
          </div>
        )}
      </div>
    </div>
  );
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap rounded-input border border-border bg-surface-2 p-3 font-mono text-[12.5px] text-text">
      {text}
    </pre>
  );
}
