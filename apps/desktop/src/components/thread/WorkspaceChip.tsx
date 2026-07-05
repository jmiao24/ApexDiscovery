import { useState } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { isTauri, pickFolder } from "@/lib/tauri";
import { datedWorkspaceName, useRuntimeStore } from "@/lib/runtime";

/** Last path segment of the workspace folder, or "Workspace" when unknown. */
export function baseName(path: string | null): string {
  if (!path) return "Workspace";
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "Workspace";
}

/**
 * Where the session's files live, shown in the session header next to the
 * title. A fresh draft starts in a new dated folder by default — the chip is
 * just a folder icon that opens the native picker for anyone who wants a
 * specific folder instead (the pick pins it). Once the session exists its
 * folder is a fact, so the chip becomes a quiet indicator.
 */
export function WorkspaceChip() {
  const workspace = useRuntimeStore((s) => s.workspace);
  const currentId = useRuntimeStore((s) => s.currentId);
  const workspacePinned = useRuntimeStore((s) => s.workspacePinned);
  const switchWorkspace = useRuntimeStore((s) => s.switchWorkspace);
  const sending = useRuntimeStore((s) => s.sending);
  const [busy, setBusy] = useState(false);

  if (!isTauri) return null;

  // An open session's folder is not a choice anymore — just say where it is.
  if (currentId) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted" title={workspace ?? undefined}>
        <Folder size={12} className="shrink-0" />
        <span className="max-w-[180px] truncate">{baseName(workspace)}</span>
      </span>
    );
  }

  const choose = async () => {
    const dir = await pickFolder();
    if (!dir) return; // cancelled — keep the current destination
    setBusy(true);
    try {
      await switchWorkspace({ path: dir }); // an explicit pick pins the folder
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className="flex items-center gap-1 rounded-input px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60"
      onClick={() => void choose()}
      disabled={busy || sending}
      title={
        workspacePinned
          ? `${workspace ?? ""} — click to choose a different folder`
          : `Starts in a new dated folder (${datedWorkspaceName()}) — click to choose a folder instead`
      }
      aria-label="Choose session folder"
    >
      <FolderOpen size={14} className="shrink-0" />
      {busy ? (
        <span>Switching…</span>
      ) : (
        workspacePinned && <span className="max-w-[200px] truncate">{baseName(workspace)}</span>
      )}
    </button>
  );
}
