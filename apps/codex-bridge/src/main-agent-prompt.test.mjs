import assert from "node:assert/strict";
import test from "node:test";
import { APEX_MAIN_AGENT_PROMPT } from "./main-agent-prompt.mjs";

test("ships an APEX biomedical research prompt without Biomni-only infrastructure", () => {
  assert.match(APEX_MAIN_AGENT_PROMPT, /^You are APEX Discovery,/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /# Biomedical Evidence Standards/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /# Computational Work/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /# Skills and Tools/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /# Visualization Standards/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /native web research/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /ExecuteCode/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /Bash/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /Place each citation inline/);
  assert.match(APEX_MAIN_AGENT_PROMPT, /do not append a standalone source list/);
  assert.doesNotMatch(APEX_MAIN_AGENT_PROMPT, /checks evidence-backed answers at runtime/);
  assert.doesNotMatch(APEX_MAIN_AGENT_PROMPT, /blocked if they still lack/);

  for (const unsupported of [
    "Biomni",
    "Phylo",
    "/mnt/results",
    "/mnt/datalake",
    "EnterPlanMode",
    "SendUserMessage",
    "TodoWrite",
    "BiomniResourcesLookup",
    "ManageMachine",
    "---FOLLOW_UP_QUESTIONS---",
  ]) {
    assert.doesNotMatch(APEX_MAIN_AGENT_PROMPT, new RegExp(unsupported.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
