import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, Files, Plus, Settings, SlidersHorizontal } from "lucide-react";
import type { Project } from "@ai4s/shared";
import { cn } from "@/lib/cn";
import { useRuntimeStore } from "@/lib/runtime";
import { StatusPills } from "./StatusPills";

export function Sidebar({ project }: { project: Project }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessions, status, newSession } = useRuntimeStore();

  const startNew = async () => {
    if (status === "ready") {
      const id = await newSession();
      navigate(id ? `/live/${id}` : "/live");
    } else {
      navigate("/live");
    }
  };

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
        onClick={() => navigate("/live")}
      >
        <ChevronLeft size={16} className="text-muted" />
        <span className="flex-1 truncate">{project.name}</span>
        <ChevronDown size={16} className="text-muted" />
      </button>

      <nav className="mt-1 flex flex-col px-3">
        <NavRow icon={<Plus size={16} />} label="New" onClick={startNew} />
        <NavRow icon={<SlidersHorizontal size={16} />} label="Customize" onClick={() => navigate("/settings")} />
        <NavRow icon={<Files size={16} />} label="Skills" onClick={() => navigate("/skills")} />
      </nav>

      <div className="mt-4 flex-1 overflow-y-auto px-3 pb-2">
        {sessions.length > 0 && (
          <Group title="Sessions">
            {sessions.map((s) => (
              <Row
                key={s.id}
                to={`/live/${s.id}`}
                active={location.pathname === `/live/${s.id}`}
                dot="bg-ok"
                title={s.title}
              />
            ))}
          </Group>
        )}
        <Group title="Examples">
          {project.sessions.map((s) => (
            <Row
              key={s.id}
              to={`/example/${s.id}`}
              active={location.pathname === `/example/${s.id}`}
              dot="bg-muted"
              title={s.title}
              badge={s.badge}
            />
          ))}
        </Group>
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted">{title}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({
  to,
  active,
  dot,
  title,
  badge,
}: {
  to: string;
  active: boolean;
  dot: string;
  title: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      className={cn(
        "flex items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-surface-2",
        active ? "bg-surface-2 text-text" : "text-text/90",
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <span className="flex-1 truncate">{title}</span>
      {badge != null && (
        <span className="rounded-full bg-surface-2 px-1.5 text-xs text-muted ring-1 ring-border">
          {badge}
        </span>
      )}
    </NavLink>
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
