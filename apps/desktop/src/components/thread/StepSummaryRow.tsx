import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StepSummaryBlock } from "@ai4s/shared";
import { cn } from "@/lib/cn";

export function StepSummaryRow({ block }: { block: StepSummaryBlock }) {
  const { t } = useTranslation(["session", "common"]);
  const [open, setOpen] = useState(false);
  const hasDetails = (block.details?.length ?? 0) > 0;
  return (
    <div className="overflow-hidden rounded-[18px] bg-[var(--activity-surface)]">
      <button
        className="flex w-full items-center gap-3 px-5 py-4 text-left text-[15px] text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-link"
        onClick={() => hasDetails && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRight
          size={18}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="flex-1 truncate">{block.summary}</span>
        <span className="shrink-0 text-sm tabular-nums">{t("stepSummary.steps", { count: block.steps })}</span>
      </button>
      {open && hasDetails && (
        <ul className="space-y-2 border-t border-faint px-12 py-4 text-sm text-muted">
          {block.details!.map((d, i) => (
            <li key={i} className="list-disc">
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
