import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  NotebookPen,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import type { Project } from "@ai4s/shared";
import { cn } from "@/lib/cn";
import { isTauri, pickFolder } from "@/lib/tauri";
import { useRuntimeStore } from "@/lib/runtime";
import { StatusPills } from "./StatusPills";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import logo from "@/assets/logo.webp";

interface Row {
  id: string;
  title: string;
  to: string;
  kind: "session" | "example";
}

export function Sidebar({ project }: { project: Project }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessions, hiddenExamples, startDraft, deleteSession, hideExample } = useRuntimeStore();

  const startNew = () => {
    startDraft();
    navigate("/live");
  };

  const rows: Row[] = [
    ...sessions.map((s) => ({ id: s.id, title: s.title, to: `/live/${s.id}`, kind: "session" as const })),
    ...project.sessions
      .filter((e) => !hiddenExamples.includes(e.id))
      .map((e) => ({ id: e.id, title: e.title, to: `/example/${e.id}`, kind: "example" as const })),
  ];

  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);

  const confirmDelete = () => {
    const row = pendingDelete;
    setPendingDelete(null);
    if (!row) return;
    if (row.kind === "session") void deleteSession(row.id);
    else hideExample(row.id);
    if (location.pathname === row.to) navigate("/live");
  };

  // With the overlay titlebar (macOS), reserve a draggable strip at the top so
  // the traffic lights don't overlap the logo and the window stays movable.
  const overlayTitlebar = isTauri && navigator.userAgent.includes("Mac");

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-border bg-surface">
      {overlayTitlebar && <div data-tauri-drag-region className="h-8 shrink-0" />}
      <div className={cn("px-4 pb-3", overlayTitlebar ? "pt-1" : "pt-4")}>
        <div className="flex items-baseline gap-1.5">
          <img src={logo} alt="" className="h-[18px] w-auto self-center" />
          <div className="font-serif text-[17px] font-semibold leading-none tracking-tight text-text">
            Open Science
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted">Beta</span>
        </div>
      </div>

      {isTauri && <WorkspaceSwitcher />}

      <nav className="flex flex-col px-3">
        <NavRow icon={<Plus size={16} />} label="New" onClick={startNew} />
        <NavRow icon={<NotebookPen size={16} />} label="Notebooks" onClick={() => navigate("/notebooks")} />
        <NavRow icon={<FolderTree size={16} />} label="Files" onClick={() => navigate("/files")} />
        <NavRow icon={<Files size={16} />} label="Skills" onClick={() => navigate("/skills")} />
      </nav>

      <div className="mt-4 flex-1 overflow-y-auto px-3 pb-2">
        <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted">History</div>
        {rows.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted">No conversations yet.</div>
        )}
        {rows.map((row) => (
          <div key={row.to} className="group relative">
            <NavLink
              to={row.to}
              className={cn(
                "flex items-center gap-2 rounded-input py-1 pl-2 pr-8 text-[13px] hover:bg-surface-2",
                location.pathname === row.to ? "bg-surface-2 text-text" : "text-text/90",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  row.kind === "example" ? "bg-muted" : "bg-ok",
                )}
              />
              <span className="flex-1 truncate">{row.title}</span>
              {row.kind === "example" && (
                <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] uppercase tracking-wide text-muted ring-1 ring-border">
                  example
                </span>
              )}
            </NavLink>
            <button
              onClick={() => setPendingDelete(row)}
              aria-label={`Delete ${row.title}`}
              className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted hover:bg-border hover:text-error group-hover:block"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-border px-3 py-3">
        <StatusPills />
        <button
          className="mt-2 flex items-center gap-2 rounded-input px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-text"
          onClick={() => navigate("/settings")}
          aria-label="Settings"
        >
          <Settings size={15} />
          <span>Settings</span>
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === "session" ? "Delete session?" : "Hide example?"}
          body={
            pendingDelete.kind === "session"
              ? `"${pendingDelete.title}" and its messages will be deleted. This cannot be undone.`
              : `"${pendingDelete.title}" will be hidden from the sidebar.`
          }
          confirmLabel={pendingDelete.kind === "session" ? "Delete" : "Hide"}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}

function baseName(path: string | null): string {
  if (!path) return "Workspace";
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "Workspace";
}

/** Dated folder name like 2026-07-04-1615 for a one-click fresh workspace. */
function datedName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Shows the active workspace folder and lets the user create a new dated folder
 *  or open an existing one — so sessions/files aren't all dumped in one place. */
function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const workspace = useRuntimeStore((s) => s.workspace);
  const switchWorkspace = useRuntimeStore((s) => s.switchWorkspace);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = async (target: { path: string } | { dated: string }) => {
    setOpen(false);
    setBusy(true);
    try {
      await switchWorkspace(target);
      navigate("/live");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative px-3 pb-2" ref={ref}>
      <button
        className="flex w-full items-center gap-1.5 rounded-input border border-border bg-surface-2/60 px-2 py-1.5 text-left text-xs text-text hover:bg-surface-2 disabled:opacity-60"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title={workspace ?? undefined}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Folder size={13} className="shrink-0 text-muted" />
        <span className="flex-1 truncate font-medium">{busy ? "Switching…" : baseName(workspace)}</span>
        <ChevronDown size={12} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-3 right-3 z-20 mt-1 overflow-hidden rounded-card border border-border bg-surface py-1 shadow-lg"
        >
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text hover:bg-surface-2"
            onClick={() => void go({ dated: datedName() })}
          >
            <FolderPlus size={13} className="text-muted" /> New dated folder
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text hover:bg-surface-2"
            onClick={() =>
              void (async () => {
                const dir = await pickFolder();
                if (dir) await go({ path: dir });
                else setOpen(false);
              })()
            }
          >
            <FolderOpen size={13} className="text-muted" /> Open folder…
          </button>
        </div>
      )}
    </div>
  );
}

function NavRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-input px-2 py-1 text-[13px] text-text hover:bg-surface-2"
    >
      <span className="text-muted">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
