import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
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
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", executionMode: "danger-full-access" });
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
    assert.match(audit, /"execution_mode":"danger-full-access"/);
    assert.match(audit, /"human_description":"Checking the shell runtime"/);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ExecuteCode keeps Python state and appends every call to an ipynb trace", async () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", executionMode: "danger-full-access" });
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
    assert.equal(first.notebook_path, "execution_trace/worker-0.ipynb");
    assert.equal(relative(runtime.workspaceRoot, runtime.notebookPath("worker-0", "r")), "execution_trace/worker-0-r.ipynb");
    assert.equal(first.notebook_cell_index, 1);
    assert.equal(second.notebook_cell_index, 2);
    const notebook = JSON.parse(readFileSync(join(root, second.notebook_path), "utf8"));
    assert.equal(notebook.nbformat, 4);
    assert.equal(notebook.cells.length, 2);
    assert.equal(notebook.cells[1].metadata.apex_discovery.human_description, "Calculating the adjusted cohort size");
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ExecuteCode migrates the hidden legacy Python trace into the visible notebook", async () => {
  const root = workspace();
  const legacy = join(root, ".apex-discovery", "execution_trace", "worker-0-python.ipynb");
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", executionMode: "danger-full-access" });
  try {
    const seed = await runtime.runCode({
      code: "print('legacy')",
      language: "python",
      human_description: "Writing the legacy notebook cell",
      environment: "workspace",
    });
    const visible = join(root, seed.notebook_path);
    mkdirSync(dirname(legacy), { recursive: true });
    renameSync(visible, legacy);

    const migrated = await runtime.runCode({
      code: "print('visible')",
      language: "python",
      human_description: "Migrating the execution notebook trace",
      environment: "workspace",
    });
    assert.equal(migrated.notebook_path, "execution_trace/worker-0.ipynb");
    assert.equal(migrated.notebook_cell_index, 2);
    assert.equal(existsSync(legacy), false);
    const notebook = JSON.parse(readFileSync(join(root, migrated.notebook_path), "utf8"));
    assert.equal(notebook.cells.length, 2);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ExecuteCode rejects staged script wrappers", () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", executionMode: "danger-full-access" });
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
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", executionMode: "danger-full-access" });
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
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", executionMode: "danger-full-access" });
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
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root, sessionId: "ses_test", executionMode: "danger-full-access" });
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

test("execution refuses to run when no execution mode was granted", async () => {
  const root = workspace();
  const runtime = new ScienceExecutionRuntime({ workspaceRoot: root });
  try {
    assert.throws(
      () => runtime.runBash({
        command: "pwd",
        human_description: "Checking the workspace location",
        environment: "workspace",
      }),
      /disabled/,
    );
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
