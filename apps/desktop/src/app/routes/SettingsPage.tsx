import { useState } from "react";
import { useUiStore } from "@/lib/store";
import { useRuntimeStore } from "@/lib/runtime";
import { configureOpenCode, isTauri } from "@/lib/tauri";
import { cn } from "@/lib/cn";

// Maps the UI provider label to OpenCode's provider id.
const PROVIDER_ID: Record<string, string> = {
  OpenRouter: "openrouter",
  "OpenAI-compatible": "openai",
  Anthropic: "anthropic",
  "Local (Ollama)": "ollama",
};

/**
 * Settings. API credentials are editable and start empty (BYOK). The agent
 * runtime is OpenCode; the model provider is the user's own key.
 */
export function SettingsPage() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { status, serverUrl, setServerUrl, connect, disconnect } = useRuntimeStore();

  const [provider, setProvider] = useState("OpenRouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [workspace, setWorkspace] = useState("~/AI4S Workbench/workspaces");
  const [backend, setBackend] = useState("Local (manual approval)");
  const [saveMsg, setSaveMsg] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    const res = await configureOpenCode({
      provider: PROVIDER_ID[provider] ?? provider.toLowerCase(),
      apiKey,
      model,
      baseUrl: baseUrl || undefined,
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg(`Saved to ${res.path}. Reconnect the runtime to apply.`);
    } else if (res.reason === "not-desktop") {
      setSaveMsg(
        apiKey
          ? "Saved in-app. Run the desktop app to write the key into OpenCode, or configure it with `opencode auth`."
          : "Enter an API key first, or configure OpenCode with `opencode auth`.",
      );
    } else {
      setSaveMsg(`Could not write config: ${res.message}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <h1 className="font-serif text-2xl text-text">Settings</h1>

        <Field label="Agent runtime" hint="AI4S Workbench drives OpenCode (opencode serve) over its HTTP + SSE API.">
          <div className="flex items-center gap-2">
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://127.0.0.1:4096"
              className="flex-1 rounded-input border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-muted"
            />
            {status === "ready" ? (
              <button
                onClick={disconnect}
                className="rounded-input border border-border px-4 py-2 text-sm text-text hover:bg-surface-2"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={connect}
                className="rounded-input bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
              >
                Connect
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                status === "ready" ? "bg-ok" : status === "error" ? "bg-error" : "bg-muted",
              )}
            />
            OpenCode runtime · <span className="capitalize">{status}</span>
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
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-input bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
          <span className="text-xs text-muted">
            {saveMsg ||
              (isTauri
                ? "Writes your key into OpenCode's config."
                : "Desktop app writes the key into OpenCode; in the browser, use `opencode auth`.")}
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
