import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bot, Boxes, Check, Package, Plug, Puzzle, Trash2, X } from "lucide-react";
import { useRuntimeStore } from "@/lib/runtime";
import { cn } from "@/lib/cn";
import {
  installExtension,
  isWebShell,
  listExtensions,
  removeExtension,
  setExtensionEnabled,
  type InstalledExtension,
} from "@/lib/tauri";

/**
 * Skills, agents, install-a-skill, and detected scientific environment — all real:
 * skills/agents from the OpenCode runtime, environment from the host system.
 */
export function SkillsPage() {
  const { t } = useTranslation(["pages", "common"]);
  const navigate = useNavigate();
  const { skills, agents, tools, status, loadCatalog, detectTools, installSkill } = useRuntimeStore();
  const connected = status === "ready";
  const [text, setText] = useState("");
  const [installing, setInstalling] = useState(false);
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const [extensionSource, setExtensionSource] = useState("");
  const [extensionBusy, setExtensionBusy] = useState<string | null>(null);
  const [extensionError, setExtensionError] = useState<string | null>(null);

  const refreshExtensions = async () => {
    if (!isWebShell()) return;
    try {
      setExtensions(await listExtensions());
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (connected) void loadCatalog();
    void detectTools();
    void refreshExtensions();
    // The shell type is fixed before React mounts; refreshExtensions is local
    // to this route and intentionally does not participate in effect identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, loadCatalog, detectTools]);

  const onInstallExtension = async () => {
    const source = extensionSource.trim();
    if (!source || extensionBusy) return;
    setExtensionBusy("install");
    setExtensionError(null);
    try {
      await installExtension(source);
      setExtensionSource("");
      await refreshExtensions();
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : String(error));
    } finally {
      setExtensionBusy(null);
    }
  };

  const toggleExtension = async (extension: InstalledExtension) => {
    setExtensionBusy(extension.name);
    setExtensionError(null);
    try {
      await setExtensionEnabled(extension.name, !extension.enabled);
      await Promise.all([refreshExtensions(), loadCatalog()]);
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : String(error));
    } finally {
      setExtensionBusy(null);
    }
  };

  const uninstallExtension = async (extension: InstalledExtension) => {
    setExtensionBusy(extension.name);
    setExtensionError(null);
    try {
      await removeExtension(extension.name);
      await Promise.all([refreshExtensions(), loadCatalog()]);
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : String(error));
    } finally {
      setExtensionBusy(null);
    }
  };

  const onInstall = async () => {
    if (!text.trim()) return;
    setInstalling(true);
    const id = await installSkill(text.trim());
    setInstalling(false);
    if (id) {
      setText("");
      navigate(`/live/${id}`); // watch the agent install it
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="font-serif text-xl text-text">{t("skills.title")}</h1>
        <p className="mt-1 text-sm text-muted">
          {t("skills.description.prefix")}
          {/* eslint-disable-next-line i18next/no-literal-string -- literal filesystem path, not prose */}
          <span className="font-mono">.opencode/skills/</span>
          {t("skills.description.suffix")}
        </p>

        {isWebShell() && (
          <Section title={t("skills.extensions.sectionTitle")} icon={<Plug size={15} />}>
            {extensions.map((extension) => (
              <div key={extension.name} className="flex items-start gap-3 px-4 py-3">
                <Package size={16} className="mt-0.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-text">{extension.name}</span>
                    <span className="text-[11px] text-muted">{extension.version}</span>
                  </div>
                  <div className="line-clamp-2 text-xs text-muted">{extension.description}</div>
                  <div className="mt-1 text-[11px] text-muted">
                    {t("skills.extensions.capabilities", {
                      skills: extension.skills.length,
                      mcp: extension.mcpServers.length,
                    })}
                    {extension.hasScripts ? ` · ${t("skills.extensions.scripts")}` : ""}
                    {extension.hasHooks ? ` · ${t("skills.extensions.hooks")}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleExtension(extension)}
                  disabled={extensionBusy !== null}
                  className={cn(
                    "rounded-input px-2.5 py-1 text-xs ring-1 disabled:opacity-40",
                    extension.enabled
                      ? "bg-ok/10 text-ok ring-ok/30"
                      : "bg-surface-2 text-muted ring-border",
                  )}
                >
                  {extension.enabled
                    ? t("skills.extensions.enabled")
                    : t("skills.extensions.disabled")}
                </button>
                <button
                  type="button"
                  onClick={() => void uninstallExtension(extension)}
                  disabled={extensionBusy !== null}
                  aria-label={t("skills.extensions.remove", { name: extension.name })}
                  className="mt-0.5 text-muted hover:text-error disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {extensions.length === 0 && <Empty>{t("skills.extensions.empty")}</Empty>}
            <div className="space-y-2 bg-surface-2/50 p-4">
              <input
                value={extensionSource}
                onChange={(event) => setExtensionSource(event.target.value)}
                placeholder={t("skills.extensions.sourcePlaceholder")}
                className="w-full rounded-input border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-muted"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void onInstallExtension()}
                  disabled={!extensionSource.trim() || extensionBusy !== null}
                  className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
                >
                  {extensionBusy === "install"
                    ? t("skills.extensions.installing")
                    : t("skills.extensions.install")}
                </button>
                <span className="text-xs text-muted">{t("skills.extensions.reviewHint")}</span>
              </div>
              {extensionError && <p className="text-xs text-error">{extensionError}</p>}
            </div>
          </Section>
        )}

        {/* Install a skill (#1) */}
        <Section title={t("skills.install.sectionTitle")} icon={<Boxes size={15} />}>
          <div className="p-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("skills.install.placeholder")}
              rows={3}
              className="w-full resize-y rounded-input border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={onInstall}
                disabled={!connected || !text.trim() || installing}
                className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {installing ? t("skills.install.starting") : t("skills.install.cta")}
              </button>
              <span className="text-xs text-muted">
                {connected ? t("skills.install.hintConnected") : t("skills.install.hintDisconnected")}
              </span>
            </div>
          </div>
        </Section>

        {/* Environment (#2) */}
        <Section title={t("skills.environment.sectionTitle")} icon={<Package size={15} />}>
          {tools.length === 0 && <Empty>{t("skills.environment.detectionUnavailable")}</Empty>}
          {tools.map((tool) => (
            <div key={tool.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {tool.found ? <Check size={15} className="text-ok" /> : <X size={15} className="text-muted" />}
              <span className="w-24 text-text">{tool.name}</span>
              <span className="flex-1 truncate font-mono text-xs text-muted">
                {tool.found ? tool.version ?? t("skills.environment.found") : t("skills.environment.notFound")}
              </span>
            </div>
          ))}
          <p className="px-4 py-2 text-xs text-muted">{t("skills.environment.note")}</p>
        </Section>

        {connected ? (
          <>
            <Section title={t("skills.agentsSection.sectionTitle", { count: agents.length })} icon={<Bot size={15} />}>
              {agents.length === 0 && <Empty>{t("skills.agentsSection.empty")}</Empty>}
              {agents.map((a) => {
                const mode = modeOf(a.mode);
                const modeLabel = mode ? t(`skills.agentsSection.agentMode.${mode}`) : a.mode;
                return <RowItem key={a.name} name={a.name} desc={a.description} tag={modeLabel} />;
              })}
            </Section>
            <Section title={t("skills.skillsListSection.sectionTitle", { count: skills.length })} icon={<Puzzle size={15} />}>
              {skills.length === 0 && <Empty>{t("skills.skillsListSection.empty")}</Empty>}
              {skills.map((s) => {
                const source = sourceOf(s.location);
                const sourceLabel =
                  source === "builtin"
                    ? t("skills.skillsListSection.source.builtin")
                    : source === "project"
                      ? t("skills.skillsListSection.source.project")
                      : source === "user"
                        ? t("skills.skillsListSection.source.user")
                        : undefined;
                return <RowItem key={s.name} name={s.name} desc={s.description} tag={sourceLabel} />;
              })}
            </Section>
          </>
        ) : (
          <div className="mt-6 rounded-card border border-border bg-surface p-5 text-sm text-muted">
            {t("skills.disconnected")}
          </div>
        )}
      </div>
    </div>
  );
}

type SkillSource = "builtin" | "project" | "user";

function sourceOf(location?: string): SkillSource | undefined {
  if (!location) return undefined;
  if (location.includes("/builtin/")) return "builtin";
  if (location.includes("/.opencode/")) return "project";
  return "user";
}

// AgentInfo.mode is typed `string` (external SDK), but OpenCode only ever
// emits "primary" | "subagent" | "all" — see useRuntimeStore's a.mode ===
// "primary" check. Narrow to the known set so we can translate it; unknown
// values (future SDK additions) fall back to the raw string at the call site.
type AgentMode = "primary" | "subagent" | "all";

function modeOf(mode?: string): AgentMode | undefined {
  return mode === "primary" || mode === "subagent" || mode === "all" ? mode : undefined;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
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
        <div className={cn("text-xs text-muted", "line-clamp-2")}>{desc}</div>
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
