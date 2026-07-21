import assert from "node:assert/strict";
import test from "node:test";
import {
  auditInlineCitations,
  citationRepairPrompt,
  userRequestedBibliography,
} from "./inline-citations.mjs";

test("accepts claim-level inline citations in prose and evidence tables", () => {
  const answer = `EGFR has experimental structures in PDB. [RCSB PDB](https://www.rcsb.org/uniprot/P00533)

| Target | Binding evidence |
| --- | --- |
| EGFR | Direct binding activities are available. [ChEMBL](https://www.ebi.ac.uk/chembl/explore/target/CHEMBL203) |`;
  const audit = auditInlineCitations(answer);
  assert.equal(audit.ok, true);
  assert.equal(audit.citationCount, 2);
  assert.equal(audit.uncitedClaims.length, 0);
});

test("rejects uncited factual sentences even when a later sentence is cited", () => {
  const answer = "EGFR has 388 experimental structures. Direct binding data are available. [ChEMBL](https://www.ebi.ac.uk/chembl/)";
  const audit = auditInlineCitations(answer);
  assert.equal(audit.ok, false);
  assert.equal(audit.uncitedClaims.length, 1);
  assert.match(audit.uncitedClaims[0], /388/);
});

test("audits adjacent Chinese factual sentences independently", () => {
  const answer = "EGFR有实验结构。ChEMBL包含其结合活性。[ChEMBL](https://www.ebi.ac.uk/chembl/explore/target/CHEMBL203)";
  const audit = auditInlineCitations(answer);
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.uncitedClaims, ["EGFR有实验结构。"]);
});

test("rejects bare URLs and trailing source lists", () => {
  const answer = `EGFR has binding evidence at https://example.com.

## Sources

- [Database](https://example.com)`;
  const audit = auditInlineCitations(answer);
  assert.equal(audit.ok, false);
  assert.match(audit.issues.join(" "), /No inline|lack an inline/);
  assert.match(audit.issues.join(" "), /trailing Sources/);
});

test("rejects numbered reference markers as inline citations", () => {
  const answer = "Human genetics supports inhibition through combined pLoF burdens.[2] Local AoU data show lower WHR, P=8.78×10⁻⁷, and MAC 6,508.";
  const audit = auditInlineCitations(answer);
  assert.equal(audit.ok, false);
  assert.equal(audit.citationCount, 0);
  assert.match(audit.issues.join(" "), /No inline HTTP\(S\) Markdown citation/);
});

test("does not require external citations for commands or local delivery status", () => {
  const answer = "I updated the citation validator.\n\nRun the focused tests before merging.";
  const audit = auditInlineCitations(answer);
  assert.equal(audit.ok, true);
  assert.equal(audit.factualClaimCount, 0);
});

test("detects bibliography requests and creates a bounded repair instruction", () => {
  assert.equal(userRequestedBibliography("Include a numbered bibliography"), true);
  assert.equal(userRequestedBibliography("Use inline links"), false);
  const audit = auditInlineCitations("PDB contains 10 structures.");
  const prompt = citationRepairPrompt({ answer: "PDB contains 10 structures.", audit });
  assert.match(prompt, /Mandatory inline-citation repair/);
  assert.match(prompt, /PDB contains 10 structures/);
  assert.match(prompt, /Never invent/);
});
