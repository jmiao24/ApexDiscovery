// Stable domain types for AI4S Workbench.
// Imported by the desktop app now, and by the SDK / runtime in later slices.

export type RuntimeStatus = "connecting" | "ready" | "error" | "offline";
export type ModelStatus = "connected" | "disconnected" | "error";

export interface Project {
  id: string;
  name: string;
  sessions: Session[];
}

export type SessionGroup = "Examples" | "Today" | "Active" | "Earlier";

export interface Session {
  id: string;
  projectId: string;
  title: string;
  group: SessionGroup;
  /** Optional right-aligned count badge, e.g. running agents. */
  badge?: number;
  /** Status dot color hint. */
  status?: "idle" | "running" | "done" | "warn";
  blocks: ThreadBlock[];
  inspector?: Inspector;
}

// ---- Thread blocks (center pane) ----

export type ThreadBlock =
  | UserMessageBlock
  | AgentMessageBlock
  | StepSummaryBlock
  | ToolCallBlock
  | ReviewerBlock
  | DataTableBlock
  | FigureBlock
  | ArtifactBlock
  | RunningJobsBlock
  | StatusLineBlock;

export interface UserMessageBlock {
  kind: "user";
  text: string;
}

export interface AgentMessageBlock {
  kind: "agent";
  /** Markdown; inline `code` tokens are rendered as blue mono. */
  markdown: string;
}

export interface StepSummaryBlock {
  kind: "step-summary";
  summary: string;
  steps: number;
  details?: string[];
}

export type ToolCallStatus =
  | "pending"
  | "running"
  | "waiting-approval"
  | "success"
  | "warning"
  | "failed";

export interface ToolCallBlock {
  kind: "tool-call";
  title: string;
  status: ToolCallStatus;
  /** Right-aligned meta, e.g. "142 lines of output" or "16m 2s". */
  meta?: string;
  inputSummary?: string;
  outputSummary?: string;
}

export type FindingLevel = "warn" | "ok" | "error";

export interface ReviewFinding {
  level: FindingLevel;
  title: string;
  /** Monospace evidence body. */
  evidence?: string;
}

export interface ReviewerBlock {
  kind: "reviewer";
  findings: ReviewFinding[];
  note?: string;
}

export interface DataTableBlock {
  kind: "table";
  columns: string[];
  /** Cells rendered with mono where they look code-like. */
  rows: string[][];
  caption?: string;
}

export interface FigureBlock {
  kind: "figure";
  title: string;
  /** Image URL / data URI; a placeholder this slice. */
  src: string;
  caption?: string;
  /** Reviewer/user pins dropped on the figure. */
  annotations?: FigureAnnotation[];
}

export interface FigureAnnotation {
  index: number;
  note: string;
  /** Percent position of the pin within the image. */
  x: number;
  y: number;
}

/** File the agent produced, surfaced as a traceable artifact in the thread. */
export type ArtifactKind =
  | "figure"
  | "script"
  | "report"
  | "table"
  | "notebook"
  | "data";

export interface ArtifactBlock {
  kind: "artifact";
  /** Workspace-relative path the tool wrote. */
  path: string;
  filename: string;
  artifact: ArtifactKind;
  /** Tool that produced it, e.g. "write" / "edit". */
  tool: string;
  /** Text content when the producing tool carried it (write/edit); absent for binary. */
  content?: string;
  language?: string;
}

export interface RunningJob {
  label: string;
  elapsed: string;
}

export interface RunningJobsBlock {
  kind: "running-jobs";
  title: string; // e.g. "REMOTE · 8"
  jobs: RunningJob[];
}

export interface StatusLineBlock {
  kind: "status-line";
  text: string; // e.g. "8 running · 16m 2s"
  tone?: "running" | "done" | "review";
}

// ---- Inspector (right pane) ----

export type Inspector =
  | ArtifactInspector
  | NotebookInspector
  | PdfInspector
  | FilePreviewInspector
  | NotebookFileInspector;

/** A real .ipynb in the workspace, opened in the runnable notebook editor. */
export interface NotebookFileInspector {
  variant: "notebook-file";
  /** Workspace-relative path of the notebook. */
  path: string;
}

/** A workspace file surfaced for preview — the agent wrote it OR code produced it.
 *  Rendered by type: HTML → live iframe, PDF → pdf.js, image → <img>, text → code. */
export interface FilePreviewInspector {
  variant: "file";
  path: string;
  filename: string;
  artifact: ArtifactKind;
  language?: string;
  /** Inline text content when known (write/edit tools); else loaded from disk. */
  content?: string;
}

export interface ArtifactVersion {
  label: string; // "v1", "v2"
  /** Per-version overrides; fall back to the inspector-level fields when absent. */
  code?: string;
  executionLog?: string;
  messages?: string[];
  environment?: string;
  reviewPassed?: boolean;
}

export type ArtifactTab =
  | "Code"
  | "Execution Log"
  | "Messages"
  | "Environment"
  | "Review";

export type ArtifactType =
  | "figure"
  | "report"
  | "table"
  | "script"
  | "notebook"
  | "pdf";

export interface ArtifactInspector {
  variant: "artifact";
  title: string;
  /** Name used when downloading the script (defaults to `title`). */
  filename?: string;
  versions: ArtifactVersion[];
  activeVersion: string;
  reviewPassed?: boolean;
  inputs: string[];
  /** Source shown in the Code tab. */
  code: string;
  language: string;
  /** First line number to show. */
  codeStartLine?: number;
  executionLog?: string;
  environment?: string;
  messages?: string[];
}

export interface NotebookCell {
  index: number;
  language: string;
  code: string;
  output?: string;
  /** Base64 PNG from a display_data/execute_result output (e.g. a matplotlib figure). */
  image?: string;
}

export interface NotebookInspector {
  variant: "notebook";
  name: string;
  live: boolean;
  kernelLabel: string;
  kernelNote: string;
  cells: NotebookCell[];
}

export interface PdfInspector {
  variant: "pdf";
  title: string; // "review.pdf"
  /** HTML facsimile document sections rendered as a paper this slice. */
  doc: PdfDoc;
}

export interface PdfDoc {
  title: string;
  subtitle?: string;
  summaryTable?: DataTableBlock;
  figure?: FigureBlock;
  sections: PdfSection[];
}

export interface PdfSection {
  heading: string;
  body: string;
}

// ---- Provenance / citations ----

/** One recorded write of an artifact — a line in `.openscience/provenance.jsonl`.
 *  Every agent write appends one, so any artifact can reveal its generating
 *  code, environment, and originating conversation, per version. */
export interface ProvenanceRecord {
  /** Workspace-relative artifact path with `/` separators. */
  path: string;
  /** 1-based version, assigned on append. */
  version: number;
  /** Seconds since the epoch. */
  ts: number;
  /** Tool that produced this version, e.g. "write". */
  tool: string;
  sessionId?: string;
  /** Model configured when the version was recorded. */
  model?: string;
  /** Text the tool wrote (capped); absent for binary or indirect writes. */
  content?: string;
  log?: string;
}

export interface Citation {
  id: string; // DOI / PMID / arXiv id
  title: string;
  year?: number;
  source?: string;
}
