import { useMemo, useState } from "react";
import { Check, Grid2X2, Search, Settings2, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SkillInfo } from "@ai4s/sdk";
import { PaneTitlebarInset } from "./RightPane";
import { cn } from "@/lib/cn";

type View = "all" | "selected";
const ALL_VIEW: View = "all";
const SELECTED_VIEW: View = "selected";

/** Searchable, session-scoped skill attachment drawer. */
export function SkillPickerPane({
  skills,
  selected,
  onChange,
  onClose,
  onManage,
  controls,
}: {
  skills: SkillInfo[];
  selected: string[];
  onChange: (skills: string[]) => void;
  onClose: () => void;
  onManage: () => void;
  controls?: React.ReactNode;
}) {
  const { t } = useTranslation("session");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(ALL_VIEW);

  const uniqueSkills = useMemo(
    () => skills.filter(
      (skill, index) => skills.findIndex((candidate) => candidate.name === skill.name) === index,
    ),
    [skills],
  );
  const normalized = query.trim().toLowerCase();
  const visible = uniqueSkills.filter((skill) => {
    if (view === SELECTED_VIEW && !selected.includes(skill.name)) return false;
    return !normalized ||
      skill.name.toLowerCase().includes(normalized) ||
      skill.description?.toLowerCase().includes(normalized);
  });

  const toggle = (name: string) => onChange(
    selected.includes(name)
      ? selected.filter((item) => item !== name)
      : [...selected, name],
  );

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface">
      <header className="shrink-0 border-b border-border px-4 pb-4 pt-3">
        <div className="flex items-center gap-2">
          <PaneTitlebarInset />
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-text">
            <Sparkles size={13} className="text-accent" />
            {t("composer.skills.drawerTitle")}
          </div>
          <span className="flex-1" />
          {controls}
          <button
            onClick={onClose}
            aria-label={t("composer.skills.closeAria")}
            className="text-text hover:opacity-60"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <p className="mt-2 text-sm leading-5 text-muted">
          {t("composer.skills.drawerDescription")}
        </p>
        <label className="mt-3 flex h-10 items-center gap-2 rounded-input border border-border bg-surface-2 px-3 focus-within:border-accent/60">
          <Search size={15} className="shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("composer.skills.searchPlaceholder")}
            aria-label={t("composer.skills.searchAria")}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-36 shrink-0 flex-col border-r border-border p-2">
          <ViewButton
            active={view === ALL_VIEW}
            icon={<Grid2X2 size={14} />}
            label={t("composer.skills.all")}
            count={uniqueSkills.length}
            onClick={() => setView(ALL_VIEW)}
          />
          <ViewButton
            active={view === SELECTED_VIEW}
            icon={<Check size={14} />}
            label={t("composer.skills.selected")}
            count={selected.length}
            onClick={() => setView(SELECTED_VIEW)}
          />
          <span className="flex-1" />
          <button
            type="button"
            onClick={onManage}
            className="flex items-center gap-2 rounded-input px-2 py-2 text-left text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            <Settings2 size={14} />
            {t("composer.skills.manage")}
          </button>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto">
          <div className="border-b border-faint px-4 py-3">
            <div className="text-sm font-medium text-text">
              {view === ALL_VIEW ? t("composer.skills.all") : t("composer.skills.selected")}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {t("composer.skills.pickHint")}
            </div>
          </div>
          <div className="space-y-2 p-3">
            {visible.map((skill) => {
              const isSelected = selected.includes(skill.name);
              return (
                <button
                  key={skill.name}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={t("composer.skills.toggleAria", { name: skill.name })}
                  onClick={() => toggle(skill.name)}
                  className={cn(
                    "w-full rounded-card border p-3 text-left transition-colors",
                    isSelected
                      ? "border-accent/35 bg-accent/5"
                      : "border-border bg-surface hover:bg-surface-2",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text">{skill.name}</div>
                      {skill.description && (
                        <div className="mt-1 line-clamp-3 text-xs leading-4 text-muted">
                          {skill.description}
                        </div>
                      )}
                    </div>
                    <span className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      isSelected ? "border-accent bg-accent text-accent-fg" : "border-border",
                    )}>
                      {isSelected && <Check size={10} />}
                    </span>
                  </div>
                </button>
              );
            })}
            {visible.length === 0 && (
              <div className="px-3 py-10 text-center text-sm text-muted">
                {uniqueSkills.length === 0
                  ? t("composer.skills.none")
                  : t("composer.skills.noMatches")}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ViewButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-input px-2 py-2 text-left text-xs",
        active ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[10px] tabular-nums text-muted">{count}</span>
    </button>
  );
}
