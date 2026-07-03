// Thin bridge to the Tauri Rust side. In a plain browser these are no-ops so the
// app still runs in `pnpm dev`; in the packaged desktop app they invoke Rust commands.

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

/** Start the bundled OpenCode sidecar (desktop only). Returns its base URL. */
export async function startRuntime(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("start_runtime");
}

/** Write the provider key/model into OpenCode's config via the Rust command. */
export async function configureOpenCode(
  creds: OpenCodeCredentials,
): Promise<ConfigureResult> {
  if (!isTauri) return { ok: false, reason: "not-desktop" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string>("configure_opencode", {
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
