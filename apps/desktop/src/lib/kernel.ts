// Bridge to the local Python kernel (desktop only). In a plain browser these are
// no-ops so the app still runs in `pnpm dev`; the notebook then shows a hint.
import { isTauri } from "./tauri";

export interface ExecResult {
  ok: boolean;
  stdout: string;
  result: string | null;
  error: string | null;
}

/** Run one cell in the persistent local kernel. Returns null outside the desktop app. */
export async function kernelExecute(code: string): Promise<ExecResult | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ExecResult>("kernel_execute", { code });
}

/** Render a kernel result as the text shown under a notebook cell. */
export function formatExecResult(r: ExecResult): string {
  if (!r.ok && r.error) return r.error.trimEnd();
  const parts: string[] = [];
  if (r.stdout) parts.push(r.stdout.trimEnd());
  if (r.result !== null) parts.push(r.result);
  return parts.join("\n") || "(no output)";
}
