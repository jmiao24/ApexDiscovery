import assert from "node:assert/strict";
import test from "node:test";
import { researchRoute } from "./research-routing.mjs";

test("uses native Codex live research when no API key exists", () => {
  const route = researchRoute(null);
  assert.equal(route.useApexResearch, false);
  assert.equal(route.webSearchMode, "live");
  assert.match(route.prompt, /built-in live web research/);
  assert.match(route.prompt, /Open and read exact result URLs/);
  assert.doesNotMatch(route.prompt, /Use the apex_research MCP/);
});

test("keeps native Codex live research when an API key exists", () => {
  const route = researchRoute("sk-runtime-only");
  assert.equal(route.useApexResearch, false);
  assert.equal(route.webSearchMode, "live");
  assert.match(route.prompt, /built-in live web research/);
  assert.doesNotMatch(route.prompt, /Use the apex_research MCP/);
});

test("does not treat a blank credential as an API key", () => {
  assert.equal(researchRoute("   ").useApexResearch, false);
});
