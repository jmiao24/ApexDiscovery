import { readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const REVIEW_FENCE = /```review\s*\n([\s\S]*?)\n```/;
const REVIEWABLE_EXTENSIONS = new Set([
  ".py", ".r", ".jl", ".m", ".js", ".jsx", ".ts", ".tsx", ".ipynb",
  ".md", ".rst", ".tex", ".pdf", ".docx", ".html",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".csv", ".tsv", ".json", ".parquet", ".xlsx",
]);
const CODE_EXTENSIONS = new Set([".py", ".r", ".jl", ".m", ".js", ".jsx", ".ts", ".tsx", ".ipynb"]);
const REPORT_EXTENSIONS = new Set([".md", ".rst", ".tex", ".pdf", ".docx", ".html"]);
const FIGURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const SKIP_PARTS = new Set([".git", ".apex-discovery", ".agents", "node_modules", "target", "dist", "build"]);

function extension(path) {
  const name = String(path).toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

export function isReviewablePath(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  const traceIndex = parts.lastIndexOf("execution_trace");
  if (
    traceIndex > 0
    && parts[traceIndex - 1] === ".apex-discovery"
    && traceIndex === parts.length - 2
    && extension(path) === ".ipynb"
  ) return true;
  if (parts.some((part) => SKIP_PARTS.has(part))) return false;
  return REVIEWABLE_EXTENSIONS.has(extension(path));
}

/**
 * Find reviewable files created or touched by command-driven work (for example,
 * a Python process writing a PNG, which Codex does not always report as a
 * file_change item). The walk is deliberately bounded and skips dependency,
 * VCS, runtime-state, and skill trees.
 */
export function recentReviewableFiles(root, sinceMs, { maxDepth = 6, maxEntries = 5_000, limit = 100 } = {}) {
  if (!root) return [];
  const base = resolve(root);
  const found = [];
  let visited = 0;
  const walk = (directory, depth) => {
    if (depth > maxDepth || visited >= maxEntries || found.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited++ >= maxEntries || found.length >= limit) break;
      if (SKIP_PARTS.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isReviewablePath(path)) continue;
      try {
        if (statSync(path).mtimeMs >= sinceMs - 1_000) found.push(relative(base, path));
      } catch {
        // A concurrent tool may replace a file between readdir and stat.
      }
    }
  };
  walk(base, 0);
  return found.sort();
}

export function reviewTargets(changedPaths, recentPaths = []) {
  return [...new Set([...changedPaths, ...recentPaths].map(String).filter(isReviewablePath))].sort();
}

export function reviewerSkillNames(paths) {
  const extensions = new Set(paths.map(extension));
  const names = [];
  if ([...extensions].some((ext) => REPORT_EXTENSIONS.has(ext) || FIGURE_EXTENSIONS.has(ext))) {
    names.push("traceability-review");
  }
  if ([...extensions].some((ext) => CODE_EXTENSIONS.has(ext))) {
    names.push("stats-integrity");
  }
  // Data-only changes still benefit from traceability checks against the run
  // record, while avoiding the much heavier full-paper integrity auditor.
  if (names.length === 0 && paths.length > 0) names.push("traceability-review");
  return names;
}

function normalizeFinding(value) {
  if (!value || typeof value !== "object" || !String(value.title ?? "").trim()) return null;
  const level = ["ok", "warn", "error"].includes(value.level) ? value.level : "warn";
  return {
    level,
    title: String(value.title).trim(),
    ...(value.evidence ? { evidence: String(value.evidence) } : {}),
    ...(value.check ? { check: String(value.check) } : {}),
    ...(value.tag ? { tag: String(value.tag) } : {}),
  };
}

export function parseReview(text) {
  const match = REVIEW_FENCE.exec(String(text));
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    const findings = Array.isArray(value.findings)
      ? value.findings.map(normalizeFinding).filter(Boolean)
      : [];
    if (findings.length === 0 && !value.note) return null;
    return { findings, ...(value.note ? { note: String(value.note) } : {}) };
  } catch {
    return null;
  }
}

export function actionableFindings(review) {
  return review?.findings?.filter((finding) => finding.level === "warn" || finding.level === "error") ?? [];
}

export function reviewFence(review, { pass, verdict }) {
  const notePrefix = `Independent review pass ${pass} · ${verdict}.`;
  const note = review.note ? `${notePrefix} ${review.note}` : notePrefix;
  return `\`\`\`review\n${JSON.stringify({ findings: review.findings, note })}\n\`\`\``;
}

export function reviewerPrompt({ pass, targets, skillContext }) {
  return [
    "You are the independent APEX Discovery Reviewer Agent. You are not the Main Agent.",
    "Review the artifacts below in a fresh context. Your sandbox is read-only: never edit, delete, or create workspace files.",
    "Use deterministic scripts and provenance before model judgment. Verify only what the evidence supports; never claim the work is error-free.",
    "Focus on concrete, fixable findings with exact identifiers, quoted claims, file paths, and code/output evidence.",
    `This is review pass ${pass}. Review targets:\n${targets.map((path) => `- ${path}`).join("\n")}`,
    "Inspect related source code, run outputs, and .apex-discovery/provenance.jsonl when needed.",
    skillContext,
    "Return exactly one final fenced ```review JSON block and no other prose.",
    'Schema: {"findings":[{"level":"error|warn|ok","check":"citation|number|figure|domain|integrity","tag":"optional","title":"...","evidence":"..."}],"note":"..."}',
    "An empty actionable set is allowed, but include an ok finding or a note explaining what was actually checked.",
  ].filter(Boolean).join("\n\n");
}

export function fixPrompt(findings, targets) {
  return [
    "The independent APEX Discovery Reviewer found the issues below in the artifacts produced by this task.",
    "Fix the underlying artifacts and code; do not merely rewrite or suppress the review. Re-run the smallest relevant checks or analysis after editing.",
    `Targets:\n${targets.map((path) => `- ${path}`).join("\n")}`,
    `Reviewer findings:\n${JSON.stringify(findings, null, 2)}`,
    "When finished, briefly summarize the concrete fixes. A separate read-only Reviewer will inspect the result again.",
  ].join("\n\n");
}
