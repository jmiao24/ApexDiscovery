import { useTranslation } from "react-i18next";
import { ChevronRight, CircleHelp, ListOrdered, Microscope, Scale } from "lucide-react";

export interface WorkflowStarter {
  id: string;
  icon: React.ReactNode;
  /** Sent to the agent as-is — content, not UI copy, so it is never translated.
   *  The card's display title lives in `session:starters.<id>.title`. */
  prompt: string;
}

/** One-click examples for the evaluate-label-expansion skill. Each card sends
 *  a complete, explicit query and creates a real task immediately. */
export const WORKFLOW_STARTERS: WorkflowStarter[] = [
  {
    id: "rank-expansion",
    icon: <ListOrdered size={17} strokeWidth={1.75} />,
    prompt:
      "$evaluate-label-expansion Find and rank the strongest new label-expansion opportunities for Repatha " +
      "(evolocumab), Amgen's PCSK9-neutralizing monoclonal antibody. " +
      "Use screening-stage hard gates, distinguish new diseases from already approved populations, and return " +
      "the top 3–5 opportunities with supporting and opposing evidence, uncertainty, and the next decisive step.",
  },
  {
    id: "evaluate-candidate",
    icon: <Microscope size={17} strokeWidth={1.75} />,
    prompt:
      "$evaluate-label-expansion Evaluate TEZSPIRE (tezepelumab), Amgen's TSLP-neutralizing monoclonal antibody, " +
      "for eosinophilic COPD as a potential US label expansion. Verify the current label first, assess mechanism " +
      "direction, human translatability, exposure, safety, and development feasibility, then conclude ADVANCE, " +
      "INVESTIGATE, HOLD, or NO_GO.",
  },
  {
    id: "compare-candidates",
    icon: <Scale size={17} strokeWidth={1.75} />,
    prompt:
      "$evaluate-label-expansion Compare myasthenia gravis and systemic sclerosis as potential US " +
      "label-expansion opportunities for UPLIZNA (inebilizumab), Amgen's CD19-directed B-cell-depleting " +
      "monoclonal antibody. Verify the current label, apply the same hard gates and scoring dimensions to both, " +
      "show contradictions and missing evidence, and recommend which opportunity to investigate first.",
  },
  {
    id: "evidence-gaps",
    icon: <CircleHelp size={17} strokeWidth={1.75} />,
    prompt:
      "$evaluate-label-expansion Build an evidence-gap assessment for EVENITY (romosozumab), Amgen's " +
      "sclerostin-neutralizing monoclonal antibody, in osteogenesis imperfecta. Do not force a rank from " +
      "incomplete evidence: verify the current label, identify unknown hard gates and the most decision-relevant " +
      "missing data, and propose the smallest next analyses or studies that would reduce uncertainty.",
  },
];

/**
 * Empty-session welcome: a quiet, centered composition in the app's paper
 * aesthetic. The conversation is the point, so the copy invites a message
 * first; the starters below are an optional on-ramp, not a dashboard.
 */
export function WorkflowStarters({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useTranslation(["session", "common"]);
  // Display copy per starter id — t()'s generated key type rejects a dynamic
  // `starters.${id}.title` template, so each card's copy is looked up by id
  // from this literal-keyed map instead.
  const starterCopy: Record<string, string> = {
    "rank-expansion": t("starters.rank-expansion.title"),
    "evaluate-candidate": t("starters.evaluate-candidate.title"),
    "compare-candidates": t("starters.compare-candidates.title"),
    "evidence-gaps": t("starters.evidence-gaps.title"),
  };
  return (
    <div className="flex min-h-[62vh] flex-col items-center justify-center">
      <div className="w-full max-w-[520px]">
        <div className="text-center">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-surface px-3 py-1.5 shadow-sm">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted">
              {t("starters.poweredBy")}
            </span>
            <span aria-hidden="true" className="h-3 w-px bg-border" />
            <span className="font-serif text-[12px] font-semibold tracking-[0.01em] text-text">
              {t("starters.atlasName")}
            </span>
          </div>
          <h2 className="mt-4 font-serif text-[28px] leading-tight text-text">
            {t("starters.heading")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t("starters.subheading")}</p>
        </div>

        <div className="mt-8 overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {WORKFLOW_STARTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onPick(s.prompt);
              }}
              className="group flex w-full items-center gap-3.5 border-t border-border px-4 py-3.5 text-left transition-colors first:border-t-0 hover:bg-surface-2"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-accent ring-1 ring-border transition-colors group-hover:bg-surface">
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium text-text">
                  {starterCopy[s.id]}
                </span>
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
