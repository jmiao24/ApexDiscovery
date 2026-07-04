import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, NotebookPen, Plus } from "lucide-react";
import { addTextToWorkspace, isTauri } from "@/lib/tauri";
import { listNotebooks, type NotebookEntry } from "@/lib/artifactFile";
import { emptyIpynb } from "@/lib/notebook-file";
import type { KernelLanguage } from "@/lib/kernel";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setEntries(await listNotebooks());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close the kernel menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const createNew = async (language: KernelLanguage) => {
    setMenuOpen(false);
    try {
      const base = language === "r" ? "notebook-r.ipynb" : "notebook.ipynb";
      const name = await addTextToWorkspace(base, emptyIpynb(language));
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
          <div className="relative" ref={menuRef}>
            <button
              className="flex items-center gap-1.5 rounded-input bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={!isTauri}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Plus size={13} /> New notebook <ChevronDown size={12} className="opacity-80" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-card border border-border bg-surface py-1 shadow-lg"
              >
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text hover:bg-surface-2"
                  onClick={() => void createNew("python")}
                >
                  <NotebookPen size={13} className="text-muted" /> Python notebook
                </button>
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text hover:bg-surface-2"
                  onClick={() => void createNew("r")}
                >
                  <NotebookPen size={13} className="text-muted" /> R notebook
                </button>
              </div>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          Jupyter notebooks in your workspace. Cells run on the local Python or R kernel; the
          agent works on the same files.
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
