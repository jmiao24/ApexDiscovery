import assert from "node:assert/strict";
import test from "node:test";
import {
  literatureAgentPrompt,
  literatureSubagentTask,
  literatureSynthesisPrompt,
} from "./subagents.mjs";

test("recognizes only explicit English, Chinese, or command-style literature delegation", () => {
  assert.equal(
    literatureSubagentTask("Launch a literature subagent to review MC4R biologics"),
    "Launch a literature subagent to review MC4R biologics",
  );
  assert.equal(
    literatureSubagentTask("启动一个 literature subagent，调查 MC4R 抗体"),
    "启动一个 literature subagent，调查 MC4R 抗体",
  );
  assert.equal(literatureSubagentTask("$literature-agent evidence for MC4R obesity"), "evidence for MC4R obesity");
  assert.equal(literatureSubagentTask("Does Claude Science have subagents?"), null);
  assert.equal(literatureSubagentTask("Do not launch a literature subagent"), null);
});

test("keeps the literature agent read-only and makes Main preserve evidence", () => {
  const child = literatureAgentPrompt({ task: "MC4R", skillContext: "paper skill" });
  assert.match(child, /independent/);
  assert.match(child, /read-only/);
  assert.match(child, /Never invent a citation/);
  assert.match(child, /untrusted evidence/);
  assert.match(child, /paper skill/);
  const main = literatureSynthesisPrompt({ task: "MC4R", memo: "PMID:1" });
  assert.match(main, /Literature Subagent/);
  assert.match(main, /PMID:1/);
  assert.match(main, /do not invent additional citations/);
  assert.match(main, /untrusted research data/);
});
