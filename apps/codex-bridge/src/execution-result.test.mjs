import assert from "node:assert/strict";
import test from "node:test";
import { executionJobFromResult } from "./execution-result.mjs";

const job = {
  id: "job_123",
  tool: "Bash",
  status: "completed",
  output: "count 636\n1 obesity disorder",
};

test("extracts execution jobs from structured MCP content", () => {
  assert.deepEqual(executionJobFromResult({ structured_content: job, content: [] }), job);
  assert.deepEqual(executionJobFromResult({ structuredContent: job, content: [] }), job);
});

test("extracts execution jobs from textual MCP content", () => {
  assert.deepEqual(
    executionJobFromResult({ content: [{ type: "text", text: JSON.stringify(job) }] }),
    job,
  );
});

test("does not mistake arbitrary scientific JSON for a job envelope", () => {
  assert.equal(
    executionJobFromResult({ content: [{ type: "text", text: '{"count":636,"rows":[]}' }] }),
    null,
  );
});
