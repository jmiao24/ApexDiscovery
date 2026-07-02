import { NavLink, useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, Files, Plus, Settings, SlidersHorizontal } from "lucide-react";
import type { Project, Session, SessionGroup } from "@ai4s/shared";
import { cn } from "@/lib/cn";
import { StatusPills } from "./StatusPills";

const GROUP_ORDER: SessionGroup[] = ["Today", "Active", "Earlier"];

const DOT: Record<NonNullable<Session["status"]>, string> = {
  idle: "bg-muted",
  running: "bg-accent",
  done: "bg-ok",
  warn: "bg-warn",
};

export function Sidebar({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { sessionId } = useParams();

  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    items: project.sessions.filter((s) => s.group === g),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="px-5 pb-3 pt-5">
        <div className="font-serif text-[26px] font-semibold leading-none tracking-tight text-text">
          AI4S Workbench
        </div>
        <div className="mt-1 text-xs uppercase tracking-widest text-muted">Beta</div>
      </div>

      <button
        className="mx-3 flex items-center gap-2 rounded-input px-2 py-2 text-left text-sm font-medium text-text hover:bg-surface-2"
        onClick={() => navigate("/")}
      >
        <ChevronLeft size={16} className="text-muted" />
        <span className="flex-1 truncate">{project.name}</span>
        <ChevronDown size={16} className="text-muted" />
      </button>

      <nav className="mt-1 flex flex-col px-3">
        <NavRow icon={<Plus size={16} />} label="New" onClick={() => navigate("/")} />
        <NavRow icon={<SlidersHorizontal size={16} />} label="Customize" onClick={() => navigate("/settings")} />
        <NavRow icon={<Files size={16} />} label="Files" onClick={() => navigate("/skills")} />
      </nav>

      <div className="mt-4 flex-1 overflow-y-auto px-3 pb-2">
        {groups.map(({ group, items }) => (
          <div key={group} className="mb-3">
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted">
              {group}
            </div>
            <div className="flex flex-col">
              {items.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/project/${s.projectId}/session/${s.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-surface-2",
                    s.id === sessionId ? "bg-surface-2 text-text" : "text-text/90",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[s.status ?? "idle"])} />
                  <span className="flex-1 truncate">{s.title}</span>
                  {s.badge != null && (
                    <span className="rounded-full bg-surface-2 px-1.5 text-xs text-muted ring-1 ring-border">
                      {s.badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
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
