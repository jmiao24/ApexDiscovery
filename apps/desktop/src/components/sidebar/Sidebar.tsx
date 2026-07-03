import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Files, Plus, Settings, SlidersHorizontal, Trash2 } from "lucide-react";
import type { Project } from "@ai4s/shared";
import { cn } from "@/lib/cn";
import { useRuntimeStore } from "@/lib/runtime";
import { StatusPills } from "./StatusPills";

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

  const onDelete = (row: Row) => {
    if (row.kind === "session") {
      if (window.confirm(`Delete session "${row.title}"? This cannot be undone.`)) {
        void deleteSession(row.id);
        if (location.pathname === row.to) navigate("/live");
      }
    } else {
      hideExample(row.id);
      if (location.pathname === row.to) navigate("/live");
    }
  };

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="px-5 pb-4 pt-5">
        <div className="font-serif text-[26px] font-semibold leading-none tracking-tight text-text">
          AI4S Workbench
        </div>
        <div className="mt-1 text-xs uppercase tracking-widest text-muted">Beta</div>
      </div>

      <nav className="flex flex-col px-3">
        <NavRow icon={<Plus size={16} />} label="New" onClick={startNew} />
        <NavRow icon={<SlidersHorizontal size={16} />} label="Customize" onClick={() => navigate("/settings")} />
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
                "flex items-center gap-2 rounded-input py-1.5 pl-2 pr-8 text-sm hover:bg-surface-2",
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
              onClick={() => onDelete(row)}
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
          className="mt-2 flex items-center gap-2 rounded-input px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
          onClick={() => navigate("/settings")}
          aria-label="Settings"
        >
          <Settings size={16} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function NavRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-input px-2 py-1.5 text-sm text-text hover:bg-surface-2"
    >
      <span className="text-muted">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
