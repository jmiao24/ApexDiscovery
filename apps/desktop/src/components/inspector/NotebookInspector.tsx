import { ChevronDown, NotebookPen, X } from "lucide-react";
import type { NotebookInspector as NotebookInspectorT } from "@ai4s/shared";
import { CodeViewer } from "@/components/code-viewer/CodeViewer";

export function NotebookInspector({
  data,
  onClose,
}: {
  data: NotebookInspectorT;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <NotebookPen size={15} className="text-muted" />
        <span className="text-sm font-medium text-text">Notebook</span>
        <div className="flex-1" />
        <button className="text-muted hover:text-text" aria-label="Close inspector" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <span className="rounded-input bg-surface-2 px-2 py-1 text-sm font-medium text-text">
          {data.name}
        </span>
        <span className="text-sm text-muted">Shared with the agent</span>
        <div className="flex-1" />
        {data.live && (
          <span className="flex items-center gap-1 text-sm text-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Live
            <ChevronDown size={14} />
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {data.cells.map((cell) => (
          <div key={cell.index} className="mb-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted">
              <span className="font-mono">[{cell.index}]</span>
              <span>{cell.language}</span>
            </div>
            <CodeViewer code={cell.code} language={cell.language} startLine={1} />
            {cell.output && (
              <div className="mt-2">
                <div className="mb-1 text-xs text-muted">&gt; output</div>
                <pre className="whitespace-pre-wrap rounded-input border border-border bg-surface-2 p-3 font-mono text-[12.5px] text-text">
                  {cell.output}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>

      <footer className="border-t border-border px-4 py-3">
        <div className="text-sm font-medium text-text">{data.kernelLabel}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted">{data.kernelNote}</div>
      </footer>
    </div>
  );
}
