import assert from "node:assert/strict";
import test from "node:test";
import {
  literatureAgentPrompt,
  literatureSubagentTask,
  literatureSynthesisPrompt,
  reconcileOrphanedSubagentSteps,
} from "./subagents.mjs";

test("recognizes only explicit English or command-style literature delegation", () => {
  assert.equal(
    literatureSubagentTask("Launch a literature subagent to review MC4R biologics"),
    "Launch a literature subagent to review MC4R biologics",
  );
  assert.equal(literatureSubagentTask("$literature-agent evidence for MC4R obesity"), "evidence for MC4R obesity");
  assert.equal(literatureSubagentTask("Does this product have subagents?"), null);
  assert.equal(literatureSubagentTask("Do not launch a literature subagent"), null);
});

test("gives the literature agent Main's capabilities except nested delegation", () => {
  const child = literatureAgentPrompt({
    task: "MC4R",
    skillCatalog: "all installed skills",
    skillContext: "paper skill",
  });
  assert.match(child, /independent/);
  assert.match(child, /same workspace permission mode/);
  assert.match(child, /Do not launch, delegate to, or communicate with another subagent/);
  assert.match(child, /Never invent a citation/);
  assert.match(child, /inline immediately after every substantive literature claim/);
  assert.match(child, /Do not append a standalone source list/);
  assert.match(child, /untrusted evidence/);
  assert.match(child, /all installed skills/);
  assert.match(child, /paper skill/);
  const main = literatureSynthesisPrompt({ task: "MC4R", memo: "PMID:1" });
  assert.match(main, /Literature Subagent/);
  assert.match(main, /PMID:1/);
  assert.match(main, /do not invent additional citations/);
  assert.match(main, /Place citations inline immediately after/);
  assert.match(main, /Do not append a standalone Sources, References, or Bibliography section/);
  assert.match(main, /untrusted research data/);
});

test("repairs orphaned persisted subagent cards without touching active children", () => {
  const history = [{
    info: { role: "assistant" },
    parts: [
      {
        type: "tool",
        tool: "task",
        callID: "orphan",
        state: {
          status: "running",
          title: "Literature Agent — reviewing evidence",
          input: { agent: "Literature Agent" },
          metadata: { sessionId: "ses_orphan" },
          time: { start: 100 },
        },
      },
      {
        type: "tool",
        tool: "task",
        callID: "active",
        state: {
          status: "running",
          input: { agent: "Literature Agent" },
          metadata: { sessionId: "ses_active" },
          time: { start: 200 },
        },
      },
    ],
  }];
  const result = reconcileOrphanedSubagentSteps(history, (id) => id === "ses_active", 500);
  assert.equal(result.repaired, 1);
  assert.equal(result.history[0].parts[0].state.status, "error");
  assert.equal(result.history[0].parts[0].state.title, "Literature Agent — interrupted");
  assert.deepEqual(result.history[0].parts[0].state.time, { start: 100, end: 500 });
  assert.equal(result.history[0].parts[1].state.status, "running");
});
