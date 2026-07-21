// Bridge to the shell hosting the app. Three environments share these
// functions, with unchanged signatures at every call site:
//  - Tauri desktop: invoke Rust commands (the original path).
//  - Web shell: the self-hosted apexdiscovery-server — the same commands over
//    `POST /api/cmd/<name>` (session-cookie auth), detected via `/api/ping`
//    before the app renders (see initShell / main.tsx).
//  - Plain browser dev (`pnpm dev`): no shell — everything degrades to the
//    original no-op fallbacks.

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** True when the same-origin apexdiscovery-server answered /api/ping. Settled by
 *  initShell() before the app renders, so render-time reads are stable. */
let webShell = false;

export function isWebShell(): boolean {
  return webShell;
}

/** A shell (desktop or web server) backs the app — files, runs, provenance,
 *  and workspace commands all work. False only in plain browser dev. */
export function hasShell(): boolean {
  return isTauri || webShell;
}

/** Detect the hosting shell once, before rendering. In a browser, ping the
 *  same-origin server; also reports whether this session is already logged in
 *  (main.tsx shows the login screen when not). */
export async function initShell(): Promise<{ shell: "tauri" | "web" | "none"; authenticated: boolean }> {
  if (isTauri) return { shell: "tauri", authenticated: true };
  try {
    const res = await fetch("/api/ping");
    if (res.ok) {
      const info = (await res.json()) as { app?: string; authenticated?: boolean };
      if (info.app === "apexdiscovery-server") {
        webShell = true;
        return { shell: "web", authenticated: Boolean(info.authenticated) };
      }
    }
  } catch {
    /* no server on this origin — plain browser dev */
  }
  return { shell: "none", authenticated: false };
}

/** Exchange the server token for the HttpOnly session cookie (web shell only). */
export async function webLogin(token: string): Promise<boolean> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

export interface InstalledExtension {
  name: string;
  version: string;
  description: string;
  path: string;
  source: string;
  enabled: boolean;
  skills: string[];
  mcpServers: string[];
  hasScripts: boolean;
  hasHooks: boolean;
}

async function extensionRequest<T>(path = "", init?: RequestInit): Promise<T> {
  if (!webShell) throw new Error("extensions require the APEX local web server");
  const res = await fetch(`/api/extensions${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `extension request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* preserve status */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listExtensions(): Promise<InstalledExtension[]> {
  if (!webShell) return [];
  return extensionRequest<InstalledExtension[]>();
}

export async function installExtension(
  source: string,
  options?: { gitRef?: string; expectedCommit?: string },
): Promise<InstalledExtension> {
  return extensionRequest<InstalledExtension>("", {
    method: "POST",
    body: JSON.stringify({ source, ...options }),
  });
}

export async function setExtensionEnabled(
  name: string,
  enabled: boolean,
): Promise<InstalledExtension> {
  return extensionRequest<InstalledExtension>(`/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function removeExtension(name: string): Promise<void> {
  await extensionRequest<void>(`/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/** Run one shared shell command against the web server. */
async function webCmd<T>(name: string, args?: object): Promise<T> {
  const res = await fetch(`/api/cmd/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) {
    let message = `${name} failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep the status message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Dispatch one shared command to whichever shell hosts the app. The libs
 *  (artifactFile, runs, provenance) call this instead of Tauri's invoke so
 *  they work identically on desktop and web. Throws when there is no shell. */
export async function command<T>(name: string, args?: object): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(name, args as Record<string, unknown> | undefined);
  }
  if (webShell) return webCmd<T>(name, args);
  throw new Error("no shell available");
}

export interface OpenCodeCredentials {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type ConfigureResult =
  | { ok: true; path: string }
  | { ok: false; reason: "not-desktop" }
  | { ok: false; reason: "error"; message: string };

/** Start the agent runtime. Desktop: spawn the bundled sidecar and return its
 *  loopback URL. Web: the server supervises the sidecar and proxies it at
 *  /runtime — returns that absolute mount. Null in plain browser dev. */
export async function startRuntime(): Promise<string | null> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("start_runtime");
  }
  if (webShell) {
    await webCmd<string>("start_runtime");
    return `${window.location.origin}/runtime`;
  }
  return null;
}

/**
 * Per-run password the sidecar requires on every request (desktop only — the
 * web server injects it in its reverse proxy so it never reaches the browser;
 * browser dev talks to a user-run, passwordless `opencode serve`). Held in
 * memory on both sides; never persisted.
 */
export async function runtimePassword(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("runtime_password");
}

/**
 * Pick local files and copy them into the agent workspace. Desktop: native
 * dialog + Rust copy. Web: browser file picker + multipart upload. Returns the
 * workspace file names; [] on cancel.
 */
export async function addFilesToWorkspace(): Promise<string[]> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string[]>("add_files_to_workspace");
  }
  if (webShell) return webUploadFiles();
  return [];
}

/** Browser file picker → POST /api/upload. Resolves [] when the user cancels. */
function webUploadFiles(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return resolve([]);
      const form = new FormData();
      for (const f of files) form.append("file", f, f.name);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
        resolve((await res.json()) as string[]);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    // No reliable cancel event across browsers — a picker closed without a
    // selection simply never fires onchange, which leaves the promise pending;
    // resolve on window refocus instead so the composer never wedges.
    window.addEventListener(
      "focus",
      () => setTimeout(() => resolve([]), 500),
      { once: true },
    );
    input.click();
  });
}

/**
 * Write text into the workspace as a file, deduplicating the
 * name on collision. Returns the actual file name written.
 */
export async function addTextToWorkspace(filename: string, content: string): Promise<string> {
  if (!hasShell()) throw new Error("not running in the desktop app");
  return command<string>("add_text_to_workspace", { filename, content });
}

/**
 * Explicitly import the user's OpenCode CLI login into the app's private
 * runtime. Returns false when no CLI login exists; the sidecar
 * is restarted on success. (Web: imports the login of the machine the SERVER
 * runs on — for self-hosting on your own machine that is the same login.)
 */
export async function importOpenCodeLogin(): Promise<boolean> {
  if (!hasShell()) return false;
  return command<boolean>("import_opencode_login");
}

/** How agent actions get approved — the composer's Codex-style switch.
 *  "approve": dangerous shell commands (delete / install / remote / privilege)
 *  and web fetches prompt first. "full": everything in-workspace just runs. */
export type ApprovalMode = "approve" | "full";

/** The approval mode OpenCode's config currently holds ("approve" until changed). */
export async function getApprovalMode(): Promise<ApprovalMode> {
  if (!hasShell()) return "approve";
  const mode = await command<string>("get_approval_mode");
  return mode === "full" ? "full" : "approve";
}

/** Switch the approval mode; the sidecar restarts — the caller must reconnect. */
export async function setApprovalMode(mode: ApprovalMode): Promise<void> {
  if (!hasShell()) return;
  await command("set_approval_mode", { mode });
}

/** Network proxy for the sidecar: follow the OS, a fixed URL, or direct. */
export type ProxyMode = "system" | "custom" | "none";
export interface ProxySetting {
  mode: ProxyMode;
  /** The custom URL (empty unless mode is "custom"). */
  url: string;
  /** The proxy the sidecar would use right now; null ⇒ direct. */
  effective: string | null;
}

/** The persisted proxy setting (null in plain browser dev). */
export async function getProxySetting(): Promise<ProxySetting | null> {
  if (!hasShell()) return null;
  return command<ProxySetting>("get_proxy_setting");
}

/** Persist the proxy setting; the sidecar restarts — the caller must reconnect. */
export async function setProxySetting(mode: ProxyMode, url: string): Promise<void> {
  if (!hasShell()) return;
  await command("set_proxy_setting", { mode, url });
}

/** Remove a provider/mcp entry from the global OpenCode config (restarts the sidecar). */
export async function removeConfigEntry(section: "provider" | "mcp", key: string): Promise<void> {
  if (!hasShell()) throw new Error("not running in the desktop app");
  await command("remove_config_entry", { section, key });
}

export interface JupyterStatus {
  installed: boolean;
  running: boolean;
  url: string | null;
  token: string | null;
  mcp_command: string | null;
}

/** State of the app-managed Jupyter environment (desktop only). */
export async function jupyterStatus(): Promise<JupyterStatus | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<JupyterStatus>("jupyter_status");
}

/** Provision the isolated Jupyter env via bundled uv (first run: minutes, ~hundreds of MB). */
export async function setupJupyter(): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("setup_jupyter");
}

/** Start the managed headless jupyter-lab (idempotent). */
export async function startJupyter(): Promise<JupyterStatus> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<JupyterStatus>("start_jupyter");
}

/** Open the app-managed JupyterLab in the system browser, starting the server
 *  if needed. Returns false when Jupyter has not been set up yet (the caller
 *  should point the user at Settings). Same env the agent drives, same files.
 *
 *  `notebook` is a path RELATIVE TO THE LAB ROOT (the active workspace) — pass
 *  it to open that file directly (`/lab/tree/<path>`); omit to land on the lab
 *  home. Only pass a path you know is under the workspace root. */
export async function openJupyterLab(notebook?: string): Promise<boolean> {
  if (!isTauri) return false;
  const st = await jupyterStatus();
  if (!st?.installed) return false;
  const s = await startJupyter(); // idempotent; yields the fixed url + token
  if (!s.url || !s.token) return false;
  const rel = notebook?.trim().replace(/^\/+/, "");
  // Encode each segment but keep the "/" separators so nested paths resolve.
  const tree = rel ? "/tree/" + rel.split("/").map(encodeURIComponent).join("/") : "";
  await openExternal(`${s.url}/lab${tree}?token=${encodeURIComponent(s.token)}`);
  return true;
}

/** The interpreter local Python kernels resolve to, and where it came from. */
export interface PythonInterpreter {
  /** The manual override, if one is set (even when it no longer runs). */
  configured: string | null;
  /** What cells would actually run on right now. */
  resolved: string | null;
  source: "manual" | "system" | "jupyter-env" | null;
  error: string | null;
}

export async function pythonInterpreter(): Promise<PythonInterpreter | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PythonInterpreter>("python_interpreter");
}

/** Set (empty clears) the manual Python interpreter override. Validated on save. */
export async function setPythonPath(path: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_python_path", { path });
}

/** One live output line from a uv provisioning run (jupyter / science MCP). */
export interface SetupProgress {
  task: "jupyter" | "science";
  line: string;
}

/** Subscribe to setup progress lines; returns the unlisten function. */
export async function watchSetupProgress(
  cb: (p: SetupProgress) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<SetupProgress>("setup-progress", (e) => cb(e.payload));
}

/** Managed interpreter path for the shared science-MCP env, or null if not yet
 *  provisioned (desktop only). */
export async function scienceMcpPython(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("science_mcp_python");
}

/** Provision one open-source MCP pip package into the shared isolated env and
 *  return the managed Python path to launch it with (desktop only). */
export async function setupScienceMcp(pkg: string): Promise<string> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("setup_science_mcp", { package: pkg });
}

/** Auto-start Jupyter on launch when it was enabled before. Silent no-op otherwise. */
export async function ensureJupyter(): Promise<void> {
  try {
    const s = await jupyterStatus();
    if (s?.installed && !s.running) await startJupyter();
  } catch {
    /* Jupyter is optional — never block the app on it */
  }
}

/** Open an http(s) URL in the system browser (never navigates the webview). */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_url", { url });
    } catch {
      /* opening a link must never break the app */
    }
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export interface LatestRelease {
  version: string;
  url: string;
  name: string | null;
  publishedAt: string | null;
}

export async function latestRelease(): Promise<LatestRelease | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LatestRelease>("latest_release");
}

export type SaveResult =
  | { kind: "saved"; path: string }
  | { kind: "canceled" }
  | { kind: "not-desktop" };

/** Save text: desktop shows the native "Save As" dialog; the web shell
 *  triggers a browser download. Throws on write failure. */
export async function saveTextFile(filename: string, content: string): Promise<SaveResult> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>("save_text_file", { filename, content });
    return path ? { kind: "saved", path } : { kind: "canceled" };
  }
  if (webShell) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { kind: "saved", path: filename };
  }
  return { kind: "not-desktop" };
}

/** The active workspace directory (null in plain browser dev). */
export async function workspacePath(): Promise<string | null> {
  if (!hasShell()) return null;
  try {
    return await command<string>("workspace_path");
  } catch {
    return null;
  }
}

/** The base folder new dated workspaces are created under. */
export async function workspaceBase(): Promise<string | null> {
  if (!hasShell()) return null;
  try {
    return await command<string>("workspace_base");
  } catch {
    return null;
  }
}

/** Choose the base folder new session workspaces are created under.
 *  Returns the canonical path. Throws without a shell. */
export async function setWorkspaceBase(path: string): Promise<string> {
  if (!hasShell()) throw new Error("not running in the desktop app");
  return command<string>("set_workspace_base", { path });
}

/** Reveal the base workspace folder in the OS file manager (desktop only). */
export async function openWorkspaceBase(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_workspace_base");
}

/** Switch the active workspace folder (creates it if needed; the runtime
 *  rescopes via `?directory=` — no restart). Returns the canonical path.
 *  Throws without a shell. */
export async function setWorkspace(path: string): Promise<string> {
  if (!hasShell()) throw new Error("not running in the desktop app");
  return command<string>("set_workspace", { path });
}

/** Record which session owns the active workspace (written to
 *  `.apex-discovery/session.txt`) so skill helpers can attribute remote runs. */
export async function markSession(sessionId: string): Promise<void> {
  if (!hasShell()) return;
  await command("mark_session", { sessionId });
}

/** Best-effort local git checkpoint for the active workspace. Returns false
 *  when there were no changes. Never configures a remote or pushes. */
export async function commitWorkspaceSnapshot(message: string): Promise<boolean> {
  if (!hasShell()) return false;
  return command<boolean>("commit_workspace_snapshot", { message });
}

/** Create a new dated folder under the base workspace and switch to it. */
export async function newDatedWorkspace(name: string): Promise<string> {
  if (!hasShell()) throw new Error("not running in the desktop app");
  return command<string>("new_dated_workspace", { name });
}

/** Native folder picker; null on cancel or without the desktop app. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("pick_folder");
}

export interface ToolStatus {
  name: string;
  found: boolean;
  version?: string | null;
}

/** Detect scientific/runtime tools on the user's system (desktop only). */
export async function detectTools(): Promise<ToolStatus[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ToolStatus[]>("detect_tools");
}

/** Host aliases from the user's ~/.ssh/config (desktop only). */
export async function listSshHosts(): Promise<string[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("list_ssh_hosts");
}

export interface GpuInfo {
  name: string;
  mem_total_mib: number;
  mem_used_mib: number;
  util_pct: number;
}

/** One live SSH probe of a remote machine (capabilities + usage snapshot). */
export interface ComputeProbe {
  reachable: boolean;
  message: string | null;
  os: string | null;
  cores: number | null;
  load1: number | null;
  mem_total_bytes: number | null;
  mem_avail_bytes: number | null;
  disk_total_bytes: number | null;
  disk_free_bytes: number | null;
  gpus: GpuInfo[];
  slurm: string | null;
}

/** Static capability cache the agent reads to pick a machine. */
export interface MachineCaps {
  cores: number | null;
  mem_total_bytes: number | null;
  gpus: string[];
  slurm: string | null;
}

export interface Machine {
  host: string;
  label: string | null;
  caps: MachineCaps | null;
}

/** A Slurm queue entry. */
export interface ComputeJob {
  id: string;
  state: string;
  time: string;
  partition: string;
  name: string;
}

/** Saved remote machines (migrates a legacy hpc.json on first read). */
export async function computeMachines(): Promise<Machine[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Machine[]>("compute_machines");
}

/** Save (or update the label of) a remote machine. */
export async function addComputeMachine(host: string, label?: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("add_compute_machine", { host, label: label ?? null });
}

export async function removeComputeMachine(host: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_compute_machine", { host });
}

/** Probe a machine over SSH; also caches its static caps for the agent. */
export async function computeProbe(host: string): Promise<ComputeProbe> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ComputeProbe>("compute_probe", { host });
}

/** A Slurm host's queue. */
export async function computeJobs(host: string): Promise<ComputeJob[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ComputeJob[]>("compute_jobs", { host });
}

export async function computeCancel(host: string, jobId: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("compute_cancel", { host, jobId });
}

export interface ModalStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  hint: string | null;
}

/** Detect whether the user's Modal CLI is installed and authenticated. */
export async function modalStatus(): Promise<ModalStatus | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ModalStatus>("modal_status");
}

/** Copy a bundled example project into the workspace (idempotent; never
 *  overwrites user edits). Returns the workspace directory name. */
export async function installExample(name: string): Promise<string> {
  if (!hasShell()) throw new Error("not running in the desktop app");
  return command<string>("install_example", { name });
}

/** Append a diagnostic line to <app-data>/debug.log (no-op without a shell). */
export async function logDebug(message: string): Promise<void> {
  if (!hasShell()) return;
  try {
    await command("log_debug", { message });
  } catch {
    /* never let diagnostics break the app */
  }
}

/** True when the current UA is macOS (traffic lights live in the window chrome). */
export function isMacUA(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
}

/** Whether the macOS traffic lights overlap our content and need a left inset.
 *  Only in the packaged macOS webview (overlay titlebar) AND when not fullscreen
 *  — native fullscreen slides the lights away, so the inset would be an empty
 *  gap (the sidebar/expand buttons floated oddly indented in fullscreen). */
export function trafficLightsPresent(tauri: boolean, mac: boolean, fullscreen: boolean): boolean {
  return tauri && mac && !fullscreen;
}

/** Watch the window's fullscreen state (desktop only). Reports the current
 *  value immediately and on every enter/leave — fullscreen resizes the window,
 *  so a resize listener catches it. Returns an unlisten fn; in a plain browser
 *  it reports `false` once and unlisten is a no-op. */
export async function watchFullscreen(cb: (fullscreen: boolean) => void): Promise<() => void> {
  if (!isTauri) {
    cb(false);
    return () => {};
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const sync = async () => {
    try {
      cb(await win.isFullscreen());
    } catch {
      // Window gone or API unavailable — keep the last known value.
    }
  };
  await sync();
  return win.onResized(() => void sync());
}

/** Write the provider key/model into OpenCode's config via the shell. */
export async function configureOpenCode(
  creds: OpenCodeCredentials,
): Promise<ConfigureResult> {
  if (!hasShell()) return { ok: false, reason: "not-desktop" };
  try {
    const path = await command<string>("configure_opencode", {
      provider: creds.provider,
      apiKey: creds.apiKey,
      model: creds.model,
      baseUrl: creds.baseUrl ?? null,
    });
    return { ok: true, path };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
