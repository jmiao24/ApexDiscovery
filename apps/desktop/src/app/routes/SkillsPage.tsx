import { useEffect } from "react";
import { Bot, Package, Puzzle } from "lucide-react";
import { useRuntimeStore } from "@/lib/runtime";

/**
 * Skills & agents — the REAL ones loaded by the OpenCode runtime (built-in +
 * project `.opencode/skill/` + user config). No hardcoded/fake list.
 */
export function SkillsPage() {
  const { skills, agents, status, loadCatalog } = useRuntimeStore();
  const connected = status === "ready";

  useEffect(() => {
    if (connected) void loadCatalog();
  }, [connected, loadCatalog]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="font-serif text-2xl text-text">Skills &amp; Agents</h1>
        <p className="mt-1 text-sm text-muted">
          Loaded live from the OpenCode runtime. Add skills as Markdown files under{" "}
          <span className="font-mono">.opencode/skill/</span> in your workspace or{" "}
          <span className="font-mono">~/.config/opencode</span>.
        </p>

        {!connected && (
          <div className="mt-6 rounded-card border border-border bg-surface p-5 text-sm text-muted">
            Connect the runtime to list the skills and agents it has loaded.
          </div>
        )}

        {connected && (
          <>
            <Section title={`Agents (${agents.length})`} icon={<Bot size={15} />}>
              {agents.length === 0 && <Empty>No agents reported.</Empty>}
              {agents.map((a) => (
                <RowItem key={a.name} name={a.name} desc={a.description} tag={a.mode} />
              ))}
            </Section>

            <Section title={`Skills (${skills.length})`} icon={<Puzzle size={15} />}>
              {skills.length === 0 && <Empty>No skills loaded yet.</Empty>}
              {skills.map((s) => (
                <RowItem key={s.name} name={s.name} desc={s.description} tag={sourceOf(s.location)} />
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function sourceOf(location?: string): string | undefined {
  if (!location) return undefined;
  if (location.includes("/builtin/")) return "built-in";
  if (location.includes("/.opencode/")) return "project";
  return "user";
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
        {icon} {title}
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

function RowItem({ name, desc, tag }: { name: string; desc: string; tag?: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Package size={16} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{name}</div>
        <div className="line-clamp-2 text-xs text-muted">{desc}</div>
      </div>
      {tag && (
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted ring-1 ring-border">
          {tag}
        </span>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-sm text-muted">{children}</div>;
}
