import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { ScienceExecutionRuntime } from "./science-execution.mjs";

const enabled = process.env.APEX_RUN_SANDBOX_INTEGRATION === "1" && process.platform === "darwin";

async function waitForJob(root, id, timeoutMs = 5_000) {
  const path = join(root, ".apex-discovery", "execution_jobs", `${id}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const job = JSON.parse(readFileSync(path, "utf8"));
      if (job.status !== "running") return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`background job did not finish: ${id}`);
}

test("WorkspaceWrite Bash and ExecuteCode cannot write beside the workspace", { skip: !enabled }, async () => {
  const desktop = join(homedir(), "Desktop");
  mkdirSync(desktop, { recursive: true });
  const root = mkdtempSync(join(desktop, "apex-execution-sandbox-"));
  const outside = join(desktop, `${basename(root)}-outside.txt`);
  const runtime = new ScienceExecutionRuntime({
    workspaceRoot: root,
    sessionId: "sandbox_test",
    executionMode: "workspace-write",
  });
  try {
    const bash = await runtime.runBash({
      command: `printf inside > bash-inside.txt; printf outside > '${outside}'`,
      human_description: "Checking Bash workspace containment",
      environment: "workspace",
    });
    assert.equal(bash.status, "failed");
    assert.equal(existsSync(join(root, "bash-inside.txt")), true);
    assert.equal(existsSync(outside), false);

    const python = await runtime.runCode({
      code: `from pathlib import Path\nPath("python-inside.txt").write_text("inside")\nPath(${JSON.stringify(outside)}).write_text("outside")`,
      language: "python",
      human_description: "Checking Python workspace containment",
      environment: "workspace",
    });
    assert.equal(python.status, "failed");
    assert.equal(existsSync(join(root, "python-inside.txt")), true);
    assert.equal(existsSync(outside), false);

    const background = await runtime.runBash({
      command: `printf inside > background-inside.txt; printf outside > '${outside}'`,
      human_description: "Checking background workspace containment",
      environment: "workspace",
      run_in_background: true,
    });
    const backgroundDone = await waitForJob(root, background.id);
    assert.equal(backgroundDone.status, "failed");
    assert.equal(backgroundDone.execution_mode, "workspace-write");
    assert.equal(existsSync(join(root, "background-inside.txt")), true);
    assert.equal(existsSync(outside), false);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

test("WorkspaceWrite ExecuteCode tunnels urllib only to allowlisted public domains", { skip: !enabled }, async () => {
  const root = mkdtempSync(join(homedir(), "Desktop", "apex-execution-network-"));
  const runtime = new ScienceExecutionRuntime({
    workspaceRoot: root,
    sessionId: "network_test",
    executionMode: "workspace-write",
    allowedDomains: ["eutils.ncbi.nlm.nih.gov"],
  });
  try {
    const allowed = await runtime.runCode({
      code: 'import urllib.request\nr = urllib.request.urlopen("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=pubmed", timeout=20)\nprint(r.status)',
      language: "python",
      human_description: "Checking allowlisted NCBI access",
      environment: "workspace",
    });
    assert.equal(allowed.status, "completed", allowed.output);
    assert.match(allowed.output, /200/);

    const blocked = await runtime.runCode({
      code: 'import urllib.request\nurllib.request.urlopen("https://example.com", timeout=20)',
      language: "python",
      human_description: "Checking blocked external access",
      environment: "workspace",
    });
    assert.equal(blocked.status, "failed");
    assert.match(blocked.output, /domain is not allowlisted/);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
