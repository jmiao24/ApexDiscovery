import { useState } from "react";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/cn";

/**
 * Settings. API credentials are editable and start empty (BYOK). The agent
 * runtime is Hermes; the model provider is the user's own key.
 */
export function SettingsPage() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const [provider, setProvider] = useState("OpenRouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [workspace, setWorkspace] = useState("~/AI4S Workbench/workspaces");
  const [backend, setBackend] = useState("Local (manual approval)");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <h1 className="font-serif text-2xl text-text">Settings</h1>

        <Field label="Agent runtime" hint="AI4S Workbench drives Hermes over the TUI Gateway.">
          <div className="flex items-center gap-2 rounded-input border border-border bg-surface px-3 py-2 text-sm text-text">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            Hermes · TUI Gateway (JSON-RPC)
          </div>
        </Field>

        <Field label="Model provider" hint="BYOK — OpenRouter, OpenAI-compatible, Anthropic, or local.">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded-input border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            <option>OpenRouter</option>
            <option>OpenAI-compatible</option>
            <option>Anthropic</option>
            <option>Local (Ollama)</option>
          </select>
        </Field>

        <Field label="API key" hint="Stored in the OS keychain. Never written to logs or provenance. Leave empty until you have one.">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your API key…"
            className="w-full rounded-input border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-muted"
          />
        </Field>

        <Field label="Base URL" hint="Optional — for OpenAI-compatible or local endpoints.">
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://openrouter.ai/api/v1"
            className="w-full rounded-input border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-muted"
          />
        </Field>

        <Field label="Model" hint="Optional — leave empty to pick later.">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. anthropic/claude-sonnet-5"
            className="w-full rounded-input border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-muted"
          />
        </Field>

        <Field label="Workspace path" hint="Local-first. Projects and artifacts live here.">
          <input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 font-mono text-sm text-text"
          />
        </Field>

        <Field label="Runtime backend">
          <select
            value={backend}
            onChange={(e) => setBackend(e.target.value)}
            className="rounded-input border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            <option>Local (manual approval)</option>
            <option>Docker</option>
          </select>
        </Field>

        <Field label="Appearance">
          <div className="flex gap-2">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={cn(
                  "rounded-input border px-4 py-2 text-sm capitalize",
                  theme === t
                    ? "border-accent bg-surface-2 text-text"
                    : "border-border bg-surface text-muted hover:text-text",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        <div className="mt-8 flex items-center gap-3">
          <button className="rounded-input bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90">
            Save settings
          </button>
          <span className="text-xs text-muted">
            {apiKey ? "API key set for this session." : "No API key yet — you can add it anytime."}
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <label className="text-sm font-medium text-text">{label}</label>
      {hint && <p className="mb-2 mt-0.5 text-xs text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}
