import assert from "node:assert/strict";
import test from "node:test";
import { researchResultFromResult } from "./research-result.mjs";

const result = { kind: "search", answer: "Summary", sources: [] };

test("reads research envelopes from MCP structured content", () => {
  assert.deepEqual(researchResultFromResult({ structured_content: result }), result);
});

test("reads research envelopes from MCP text content", () => {
  assert.deepEqual(researchResultFromResult({ content: [{ type: "text", text: JSON.stringify(result) }] }), result);
});

test("rejects unrelated MCP results", () => {
  assert.equal(researchResultFromResult({ content: [{ type: "text", text: "hello" }] }), null);
});
