import { Check, Github, Package } from "lucide-react";

interface SkillItem {
  name: string;
  desc: string;
  installed: boolean;
  /** GitHub repo path for the source, if external. */
  repo?: string;
}

const CORE: SkillItem[] = [
  { name: "reproducible-research", desc: "Standardize project structure, artifacts, logs.", installed: true },
  { name: "literature-review", desc: "Search, filter, and summarize literature.", installed: true },
  { name: "bibliometric-analysis", desc: "Year trends, keywords, journals, clustering.", installed: true },
  { name: "figure-provenance", desc: "Figures must trace to code and data.", installed: true },
  { name: "citation-reviewer", desc: "Check citation format and sources.", installed: true },
  { name: "paper-to-report", desc: "Generate a Markdown report.", installed: true },
];

const RECOMMENDED: SkillItem[] = [
  {
    name: "K-Dense scientific-agent-skills",
    desc: "~148 curated scientific skills. Install by domain.",
    installed: false,
    repo: "K-Dense-AI/scientific-agent-skills",
  },
];

export function SkillsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="font-serif text-2xl text-text">Skills</h1>
        <p className="mt-1 text-sm text-muted">
          Curated install — enable by domain, review license and dependencies first.
        </p>

        <Section title="Installed">
          {CORE.map((s) => (
            <SkillRow key={s.name} item={s} />
          ))}
        </Section>

        <Section title="Recommended">
          {RECOMMENDED.map((s) => (
            <SkillRow key={s.name} item={s} />
          ))}
        </Section>

        <p className="mt-6 text-xs text-muted">
          Core skills live in <span className="font-mono">runtime/skills/core</span> and ship with the
          app. External skills open their source repo — curated install lands in a later release.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

function SkillRow({ item }: { item: SkillItem }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Package size={16} className="text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{item.name}</div>
        <div className="truncate text-xs text-muted">{item.desc}</div>
      </div>
      {item.installed ? (
        <span className="flex items-center gap-1 text-xs text-ok">
          <Check size={14} /> Enabled
        </span>
      ) : (
        <a
          href={item.repo ? `https://github.com/${item.repo}` : "#"}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 rounded-input border border-border px-3 py-1 text-xs font-medium text-text hover:bg-surface-2"
        >
          <Github size={13} /> View source
        </a>
      )}
    </div>
  );
}
