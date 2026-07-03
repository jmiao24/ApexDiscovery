// Read/open workspace files for artifact previews (desktop only). In a plain
// browser these return null / no-op so the app still runs in `pnpm dev`.
import { isTauri } from "./tauri";

export interface ArtifactFile {
  path: string;
  mime: string;
  /** "utf8" for text, "base64" for binary. */
  encoding: "utf8" | "base64";
  data: string;
  size: number;
}

/** Read a workspace-relative file. Returns null outside the desktop app or on error paths. */
export async function readArtifact(path: string): Promise<ArtifactFile | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ArtifactFile>("read_artifact", { path });
}

/** Local-server URL a workspace file is previewable at (desktop only). The tiny
 *  Rust file server gives the webview a real http://127.0.0.1 URL with correct
 *  MIME, so native viewers (PDF, images, HTML) render it directly. */
export async function previewUrl(path: string): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("preview_url", { path });
}

/** Resolve a file mentioned in an agent message to a real workspace-relative
 *  path. Agent prose may name a file without its directory ("index.html" for
 *  "canvas-project/index.html"); the backend finds it by basename. Returns
 *  null when no such file exists; echoes the path back in browser dev. */
export async function resolveArtifactPath(path: string): Promise<string | null> {
  if (!isTauri) return path;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("resolve_artifact", { path });
}

/** Open a workspace file in the OS default application (desktop only). */
export async function openArtifactExternally(path: string): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_path", { path });
}

export interface NotebookEntry {
  path: string;
  /** Seconds since the epoch (newest first from the backend). */
  modified: number;
}

/** All .ipynb files in the workspace, newest first (desktop only). */
export async function listNotebooks(): Promise<NotebookEntry[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NotebookEntry[]>("list_notebooks");
}

/** Write text to a workspace-relative path (desktop only; throws in browser). */
export async function writeWorkspaceFile(path: string, content: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("write_workspace_file", { path, content });
}

/** Build a `data:` URL from a read artifact for <img>/<iframe>/pdf.js. */
export function toDataUrl(f: ArtifactFile): string {
  if (f.encoding === "base64") return `data:${f.mime};base64,${f.data}`;
  return `data:${f.mime};charset=utf-8,${encodeURIComponent(f.data)}`;
}

/** Decode a base64 artifact into raw bytes for binary renderers (docx/xlsx/pptx). */
export function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
