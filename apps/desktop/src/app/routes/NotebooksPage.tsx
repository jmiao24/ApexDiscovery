import { useCallback, useEffect, useState } from "react";
import { NotebookPen, Plus } from "lucide-react";
import { addTextToWorkspace, isTauri } from "@/lib/tauri";
import { listNotebooks, type NotebookEntry } from "@/lib/artifactFile";
import { emptyIpynb } from "@/lib/notebook-file";
import { NotebookEditor } from "@/components/notebook/NotebookEditor";
import { toast } from "@/lib/toast";

/**
 * Notebooks live in the agent workspace as real .ipynb files: the user runs
 * cells on the app's local Python kernel, and the agent reads/edits the same
 * files — that shared file is the collaboration surface.
 */
export function NotebooksPage() {
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setEntries(await listNotebooks());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createNew = async () => {
    try {
      const name = await addTextToWorkspace("notebook.ipynb", emptyIpynb());
      await refresh();
      setOpen(name);
    } catch (err) {
      toast.error(`Could not create notebook: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (open) {
    return (
      <NotebookEditor
        path={open}
        onBack={() => {
          setOpen(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-6">
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-xl text-text">Notebooks</h1>
          <div className="flex-1" />
          <button
            className="flex items-center gap-1.5 rounded-input bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            onClick={() => void createNew()}
            disabled={!isTauri}
          >
            <Plus size={13} /> New notebook
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Jupyter notebooks in your workspace. Cells run on the local Python kernel; the agent
          works on the same files.
        </p>

        <div className="mt-5 space-y-1.5">
          {entries.length === 0 && (
            <div className="rounded-card border border-border bg-surface p-5 text-sm text-muted">
              {isTauri
                ? "No notebooks yet. Create one, or ask the agent to produce one."
                : "Notebooks are available in the desktop app."}
            </div>
          )}
          {entries.map((e) => (
            <button
              key={e.path}
              onClick={() => setOpen(e.path)}
              className="flex w-full items-center gap-2.5 rounded-card border border-border bg-surface px-4 py-2.5 text-left hover:bg-surface-2"
            >
              <NotebookPen size={15} className="shrink-0 text-muted" />
              <span className="truncate text-sm text-text">{e.path}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">
                {new Date(e.modified * 1000).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
