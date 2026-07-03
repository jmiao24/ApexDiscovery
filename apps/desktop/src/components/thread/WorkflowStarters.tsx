import { ChartScatter, FileSearch, FlaskConical } from "lucide-react";

export interface WorkflowStarter {
  icon: React.ReactNode;
  title: string;
  description: string;
  prompt: string;
}

/** One-click full-workflow prompts (P0-1): a single request that carries the
 *  agent through data → code → figure → report, all inside the app. */
export const WORKFLOW_STARTERS: WorkflowStarter[] = [
  {
    icon: <FlaskConical size={16} />,
    title: "Demo: analysis end to end",
    description: "Simulated dataset → notebook analysis → figure → report",
    prompt:
      "Run a complete demo analysis end to end: simulate a small dose–response dataset in Python, " +
      "analyze it (fit + summary statistics), save one publication-quality figure as demo_analysis/figure1.png, " +
      "and write demo_analysis/report.md summarizing the findings — every number in the report must come from " +
      "the code you ran. Keep all files in the workspace.",
  },
  {
    icon: <ChartScatter size={16} />,
    title: "Analyze my data",
    description: "Point the agent at a file you added — figures + report back",
    prompt:
      "Analyze the data file I added to the workspace end to end: explore it, run the analysis in code, " +
      "save at least one figure as a PNG, and write report.md with the findings — every number traced to " +
      "the code that produced it. Ask me which file to use if there is more than one candidate.",
  },
  {
    icon: <FileSearch size={16} />,
    title: "Audit a report",
    description: "Traceability review — citations, numbers, figures",
    prompt:
      "Use the traceability-review skill to audit the report or manuscript in my workspace: resolve every " +
      "citation, flag numbers with no traceable source, and check figures against the code that generated them. " +
      "Ask me which document to audit if there is more than one candidate.",
  },
];

/** Empty-session starters: one click sends a complete-workflow request. */
export function WorkflowStarters({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="py-6">
      <p className="text-center text-sm text-muted">
        Start a conversation — or run a whole workflow with one click.
      </p>
      <div className="mx-auto mt-4 grid max-w-[640px] gap-2.5 sm:grid-cols-3">
        {WORKFLOW_STARTERS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className="rounded-card border border-border bg-surface p-3.5 text-left shadow-card transition-colors hover:bg-surface-2"
          >
            <span className="text-accent">{s.icon}</span>
            <div className="mt-1.5 text-[13px] font-medium text-text">{s.title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted">{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
