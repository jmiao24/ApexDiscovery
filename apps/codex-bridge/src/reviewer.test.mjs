import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  actionableFindings,
  fixPrompt,
  isReviewablePath,
  parseReview,
  recentReviewableFiles,
  reviewFence,
  reviewerPrompt,
  reviewerSkillNames,
  reviewTargets,
} from "./reviewer.mjs";

test("selects reviewable artifacts and the applicable APEX reviewer skills", () => {
  assert.equal(isReviewablePath("report.md"), true);
  assert.equal(isReviewablePath(".openscience/runs.jsonl"), false);
  assert.equal(isReviewablePath("node_modules/pkg/index.js"), false);
  assert.deepEqual(
    reviewTargets(["analysis.py", "report.md", "notes.tmp", "analysis.py"], ["figure.png"]),
    ["analysis.py", "figure.png", "report.md"],
  );
  assert.deepEqual(reviewerSkillNames(["analysis.py", "report.md"]), [
    "traceability-review",
    "stats-integrity",
  ]);
});

test("reviews execution notebooks without exposing other runtime state", () => {
  assert.equal(isReviewablePath(".openscience/execution_trace/worker-0-python.ipynb"), true);
  assert.equal(isReviewablePath(".openscience/execution_jobs/job.json"), false);
  assert.equal(isReviewablePath(".openscience/private.ipynb"), false);
});

test("finds command-generated artifacts without walking runtime and dependency trees", () => {
  const root = mkdtempSync(join(tmpdir(), "apex-review-"));
  try {
    mkdirSync(join(root, "results"), { recursive: true });
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "results", "figure.png"), "image");
    writeFileSync(join(root, "node_modules", "pkg", "ignored.js"), "code");
    const files = recentReviewableFiles(root, Date.now() - 2_000);
    assert.deepEqual(files, [join("results", "figure.png")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parses structured findings, decides whether fixes are needed, and emits a normalized pass", () => {
  const parsed = parseReview(
    '```review\n{"findings":[{"level":"warn","check":"figure","title":"Stale figure","evidence":"plot.py newer"},{"level":"ok","title":"DOI resolves"}],"note":"Checked provenance."}\n```',
  );
  assert.equal(actionableFindings(parsed).length, 1);
  const normalized = reviewFence(parsed, { pass: 1, verdict: "changes requested" });
  assert.match(normalized, /Independent review pass 1/);
  assert.equal(parseReview(normalized).findings.length, 2);
});

test("builds separated read-only review and main-agent fix prompts", () => {
  const review = reviewerPrompt({
    pass: 2,
    targets: ["report.md"],
    skillContext: "<skill>Traceability instructions</skill>",
  });
  assert.match(review, /independent APEX Discovery Reviewer Agent/);
  assert.match(review, /read-only/);
  assert.match(review, /review pass 2/);
  assert.match(review, /Traceability instructions/);
  const fix = fixPrompt([{ level: "error", title: "Bad DOI" }], ["report.md"]);
  assert.match(fix, /Fix the underlying artifacts/);
  assert.match(fix, /separate read-only Reviewer/);
});
