import { ChevronRight, FileSearch, FlaskConical, LineChart } from "lucide-react";

export interface WorkflowStarter {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  prompt: string;
}

/** One-click full-workflow prompts (P0-1): a single request that carries the
 *  agent through data → code → figure → report, all inside the app. */
export const WORKFLOW_STARTERS: WorkflowStarter[] = [
  {
    id: "demo",
    icon: <FlaskConical size={17} strokeWidth={1.75} />,
    title: "Run a demo analysis, end to end",
    description: "Simulate a dataset, fit a model, and produce a figure and a traceable report.",
    prompt:
      "Run a complete demo analysis end to end: simulate a small dose–response dataset in Python, " +
      "analyze it (fit + summary statistics), save one publication-quality figure as demo_analysis/figure1.png, " +
      "and write demo_analysis/report.md summarizing the findings — every number in the report must come from " +
      "the code you ran. Keep all files in the workspace.",
  },
  {
    id: "analyze",
    icon: <LineChart size={17} strokeWidth={1.75} />,
    title: "Analyze my data",
    description: "Point the agent at a file you added; get figures and a report back.",
    prompt:
      "Analyze the data file I added to the workspace end to end: explore it, run the analysis in code, " +
      "save at least one figure as a PNG, and write report.md with the findings — every number traced to " +
      "the code that produced it. Ask me which file to use if there is more than one candidate.",
  },
  {
    id: "audit",
    icon: <FileSearch size={17} strokeWidth={1.75} />,
    title: "Audit a report for traceability",
    description: "Check citations, unsourced numbers, and figure-versus-code consistency.",
    prompt:
      "Use the traceability-review skill to audit the report or manuscript in my workspace: resolve every " +
      "citation, flag numbers with no traceable source, and check figures against the code that generated them. " +
      "Ask me which document to audit if there is more than one candidate.",
  },
];

/**
 * Empty-session welcome: a quiet, centered composition in the app's paper
 * aesthetic. The conversation is the point, so the copy invites a message
 * first; the starters below are an optional on-ramp, not a dashboard.
 */
export function WorkflowStarters({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex min-h-[62vh] flex-col items-center justify-center">
      <div className="w-full max-w-[500px]">
        <div className="text-center">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted">
            New session
          </div>
          <h2 className="mt-2.5 font-serif text-[26px] leading-tight text-text">
            What should we look into?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Describe your analysis below — or start from one of these.
          </p>
        </div>

        <div className="mt-7 overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {WORKFLOW_STARTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.prompt)}
              className="group flex w-full items-center gap-3.5 border-t border-border px-4 py-3.5 text-left transition-colors first:border-t-0 hover:bg-surface-2"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-accent ring-1 ring-border transition-colors group-hover:bg-surface">
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium text-text">{s.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">{s.description}</span>
              </span>
              <ChevronRight
                size={16}
                className="shrink-0 text-muted/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
