import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ScienceExecutionRuntime, validateHumanDescription } from "./science-execution.mjs";

function workspace() {
  return mkdtempSync(join(tmpdir(), "apex-execution-"));
}

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

test("human_description is mandatory and must be a 3-8 word action label", () => {
  assert.equal(validateHumanDescription("Calculating MC4R association scores"), "Calculating MC4R association scores");
  assert.throws(() => validateHumanDescription("Querying Targets"), /3-8 words/);
  assert.throws(() => validateHumanDescription("Querying Open Targets"), /concrete operation/);
  assert.throws(() => validateHumanDescription(""), /required/);
});

test("Bash is stateless, audited, and does not create a notebook", async () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", allowExecution: true });
  try {
    const job = await runtime.runBash({
      command: "printf 'hello'",
      human_description: "Checking the shell runtime",
      environment: "workspace",
    });
    assert.equal(job.status, "completed");
    assert.equal(job.output, "hello");
    assert.equal(job.notebook_path, null);
    const audit = readFileSync(join(root, ".apex-discovery", "execution-audit.jsonl"), "utf8");
    assert.match(audit, /"tool":"Bash"/);
    assert.match(audit, /"human_description":"Checking the shell runtime"/);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ExecuteCode keeps Python state and appends every call to an ipynb trace", async () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", allowExecution: true });
  try {
    const first = await runtime.runCode({
      code: "cohort_size = 41",
      language: "python",
      human_description: "Preparing the cohort state",
      environment: "workspace",
      machine_id: "worker-0",
    });
    const second = await runtime.runCode({
      code: "cohort_size + 1",
      language: "python",
      human_description: "Calculating the adjusted cohort size",
      environment: "workspace",
      machine_id: "worker-0",
    });
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(second.output, "42");
    assert.equal(first.notebook_path, ".apex-discovery/execution_trace/worker-0-python.ipynb");
    const notebook = JSON.parse(readFileSync(join(root, second.notebook_path), "utf8"));
    assert.equal(notebook.nbformat, 4);
    assert.equal(notebook.cells.length, 2);
    assert.equal(notebook.cells[1].metadata.apex_discovery.human_description, "Calculating the adjusted cohort size");
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ExecuteCode rejects staged script wrappers", () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", allowExecution: true });
  try {
    assert.throws(
      () => runtime.runCode({
        code: "exec(open('analysis.py', encoding='utf-8').read())",
        language: "python",
        human_description: "Running the staged analysis script",
        environment: "workspace",
      }),
      /complete inline notebook code/,
    );
    assert.throws(
      () => runtime.runCode({
        code: "source('analysis.R')",
        language: "r",
        human_description: "Running the staged analysis script",
        environment: "workspace",
      }),
      /complete inline notebook code/,
    );
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ExecuteCode rejects Bash and directs CLI work to the Bash tool", () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", allowExecution: true });
  try {
    assert.throws(
      () => runtime.runCode({
        code: "paperclip search MC4R",
        language: "bash",
        human_description: "Searching MC4R literature records",
        environment: "workspace",
      }),
      /python or r; use Bash for CLI/,
    );
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("background Bash survives closing its requesting runtime", async () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", allowExecution: true });
  try {
    const started = await runtime.runBash({
      command: "sleep 0.15; printf 'background-ok'",
      human_description: "Checking detached background execution",
      environment: "workspace",
      run_in_background: true,
    });
    assert.equal(started.status, "running");
    assert.equal(started.background, true);
    runtime.close();

    const finished = await waitForJob(root, started.id);
    assert.equal(finished.status, "completed");
    assert.equal(finished.output, "background-ok");
    assert.equal(finished.background, true);
    assert.equal(
      existsSync(join(root, ".apex-discovery", "execution_jobs", `${started.id}.request.json`)),
      false,
    );
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent background code safely appends both notebook cells", async () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", allowExecution: true });
  try {
    const first = await runtime.runCode({
      code: "print('first')",
      language: "python",
      human_description: "Writing the first background cell",
      environment: "workspace",
      run_in_background: true,
    });
    const second = await runtime.runCode({
      code: "print('second')",
      language: "python",
      human_description: "Writing the second background cell",
      environment: "workspace",
      run_in_background: true,
    });
    runtime.close();

    const [firstDone, secondDone] = await Promise.all([
      waitForJob(root, first.id),
      waitForJob(root, second.id),
    ]);
    assert.equal(firstDone.status, "completed");
    assert.equal(secondDone.status, "completed");
    const notebook = JSON.parse(readFileSync(join(root, firstDone.notebook_path), "utf8"));
    assert.equal(notebook.cells.length, 2);
    assert.deepEqual(
      new Set(notebook.cells.map((cell) => cell.metadata.apex_discovery.human_description)),
      new Set(["Writing the first background cell", "Writing the second background cell"]),
    );
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("execution refuses to run unless Full access was explicitly granted", async () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, allowExecution: false });
  try {
    assert.throws(
      () => runtime.runBash({
        command: "pwd",
        human_description: "Checking the workspace location",
        environment: "workspace",
      }),
      /Full access/,
    );
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
