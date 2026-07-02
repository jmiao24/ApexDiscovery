import type { Inspector } from "@ai4s/shared";
import { ArtifactInspector } from "./ArtifactInspector";
import { NotebookInspector } from "./NotebookInspector";
import { PdfInspector } from "./PdfInspector";

/** Right pane. Renders the correct inspector variant for the active session. */
export function InspectorShell({
  inspector,
  onClose,
}: {
  inspector: Inspector;
  onClose: () => void;
}) {
  return (
    <div className="h-full border-l border-border bg-surface" data-variant={inspector.variant}>
      {inspector.variant === "artifact" && <ArtifactInspector data={inspector} onClose={onClose} />}
      {inspector.variant === "notebook" && <NotebookInspector data={inspector} onClose={onClose} />}
      {inspector.variant === "pdf" && <PdfInspector data={inspector} onClose={onClose} />}
    </div>
  );
}
