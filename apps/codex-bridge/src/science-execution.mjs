import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = ".apex-discovery";
const TRACE_DIR = "execution_trace";
const JOB_DIR = "execution_jobs";
const AUDIT_FILE = "execution-audit.jsonl";
const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_INPUT_BYTES = 2_000_000;
const LOCK_STALE_MS = 65 * 60_000;

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function withDirectoryLock(path, operation) {
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      mkdirSync(path);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
          rmSync(path, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for the execution notebook lock");
      await delay(25);
    }
  }
  try {
    return await operation();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function cleanId(value, fallback) {
  const cleaned = String(value || fallback).trim().replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
  return cleaned || fallback;
}

export function validateHumanDescription(value) {
  if (typeof value !== "string") throw new Error("human_description is required");
  const description = value.trim();
  if (!description) throw new Error("human_description is required");
  if (description.includes("\n") || description.length > 120) {
    throw new Error("human_description must be a single short action label");
  }
  const words = description.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 8) {
    throw new Error("human_description must contain 3-8 words");
  }
  if (/^(?:running (?:a )?(?:command|code)|doing analysis|using (?:a )?tool|querying open targets)$/i.test(description)) {
    throw new Error("human_description must identify the concrete operation and object");
  }
  return description;
}

function workspacePath(root, requested = ".") {
  const rootReal = realpathSync(root);
  const target = realpathSync(resolve(rootReal, requested));
  const rel = relative(rootReal, target);
  if (rel.startsWith("..") || resolve(rootReal, rel) !== target) {
    throw new Error("working_dir must stay inside the active workspace");
  }
  return target;
}

function outputText(result) {
  return [result.stdout, result.result, result.error].filter(Boolean).join("\n").slice(0, MAX_CAPTURE_BYTES);
}

function outputCells(result) {
  const outputs = [];
  if (result.stdout) outputs.push({ output_type: "stream", name: "stdout", text: result.stdout });
  if (result.result) {
    outputs.push({
      output_type: "execute_result",
      execution_count: null,
      data: { "text/plain": result.result },
      metadata: {},
    });
  }
  if (result.error) {
    outputs.push({
      output_type: "error",
      ename: "ExecutionError",
      evalue: result.error.split("\n")[0],
      traceback: result.error.split("\n"),
    });
  }
  return outputs;
}

function boundedResult(result) {
  const cap = (value) => typeof value === "string" ? value.slice(0, MAX_CAPTURE_BYTES) : value ?? null;
  return {
    ok: Boolean(result?.ok),
    stdout: cap(result?.stdout) || "",
    result: cap(result?.result),
    error: cap(result?.error),
  };
}

function assertInputSize(value, name) {
  if (Buffer.byteLength(value, "utf8") > MAX_INPUT_BYTES) {
    throw new Error(`${name} exceeds the 2 MB execution input limit`);
  }
}

function assertInlineNotebookCode(code, language) {
  const scriptLoader = language === "python"
    ? /\b(?:exec\s*\(\s*(?:open\s*\(|(?:Path\s*\([^)]*\)\s*\.)?read_text\s*\()|runpy\s*\.\s*run_path\s*\(|%run\s+)/i
    : language === "r"
      ? /\b(?:source|sys\.source)\s*\(\s*["'][^"']+\.[rR]["']/i
      : null;
  if (scriptLoader?.test(code)) {
    throw new Error("ExecuteCode requires complete inline notebook code; do not load or execute a staged script");
  }
}

function emptyNotebook(language) {
  const specs = {
    python: { display_name: "Python 3", language: "python", name: "python3" },
    r: { display_name: "R", language: "r", name: "ir" },
  };
  return {
    cells: [],
    metadata: {
      kernelspec: specs[language],
      language_info: { name: language },
      apex_discovery: { execution_trace: true, schema_version: 1 },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

class PersistentKernel {
  constructor({ language, cwd }) {
    this.language = language;
    this.cwd = cwd;
    this.pending = new Map();
    this.seq = 0;
    this.queue = Promise.resolve();
    this.child = null;
    this.lines = null;
    this.rCodeFile = null;
  }

  start() {
    if (this.child) return;
    let command;
    let args;
    if (this.language === "python") {
      command = process.env.APEX_PYTHON || "python3";
      args = [join(SOURCE_DIR, "workers", "kernel_bridge.py")];
    } else {
      command = process.env.APEX_RSCRIPT || "Rscript";
      this.rCodeFile = join(this.cwd, STORE_DIR, `r-cell-${process.pid}-${randomUUID()}.R`);
      mkdirSync(dirname(this.rCodeFile), { recursive: true });
      writeFileSync(this.rCodeFile, "", { mode: 0o600 });
      args = [join(SOURCE_DIR, "workers", "kernel_bridge.R"), this.rCodeFile];
    }
    this.child = spawn(command, args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this.pending.get(String(response.id));
      if (!pending) return;
      this.pending.delete(String(response.id));
      pending.resolve(response);
    });
    this.child.once("error", (error) => this.failAll(error));
    this.child.once("exit", (code) => this.failAll(new Error(`${this.language} kernel exited (${code ?? "unknown"})`)));
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.child = null;
    this.lines?.close();
    this.lines = null;
  }

  stop() {
    const child = this.child;
    this.child = null;
    child?.kill("SIGKILL");
    this.lines?.close();
    this.lines = null;
    if (this.rCodeFile) rmSync(this.rCodeFile, { force: true });
    this.rCodeFile = null;
  }

  execute(code, timeoutMs) {
    const task = this.queue.then(() => this.executeOne(code, timeoutMs));
    this.queue = task.catch(() => undefined);
    return task;
  }

  executeOne(code, timeoutMs) {
    this.start();
    const id = String(++this.seq);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.stop();
        reject(new Error(`execution timed out after ${Math.ceil(timeoutMs / 60_000)} minutes`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        if (this.language === "r") {
          writeFileSync(this.rCodeFile, code, { encoding: "utf8", mode: 0o600 });
          this.child.stdin.write(`${id}\n`);
        } else {
          this.child.stdin.write(`${JSON.stringify({ id, code })}\n`);
        }
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

export class ScienceExecutionRuntime {
  constructor({ workspaceRoot, sessionId = "session", allowExecution = false } = {}) {
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    this.workspaceRoot = realpathSync(workspaceRoot);
    this.sessionId = cleanId(sessionId, "session");
    this.allowExecution = allowExecution;
    this.kernels = new Map();
    this.notebookQueues = new Map();
    this.jobs = new Map();
  }

  assertAllowed() {
    if (!this.allowExecution) {
      throw new Error("APEX execution tools require the user to select Full access");
    }
  }

  audit(entry) {
    const path = join(this.workspaceRoot, STORE_DIR, AUDIT_FILE);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  jobPath(id) {
    return join(this.workspaceRoot, STORE_DIR, JOB_DIR, `${cleanId(id, "job")}.json`);
  }

  saveJob(job) {
    this.jobs.set(job.id, job);
    atomicWrite(this.jobPath(job.id), JSON.stringify(job, null, 2));
  }

  getJob(id) {
    const clean = cleanId(id, "");
    if (!clean) throw new Error("job_id is required");
    if (this.jobs.has(clean)) return this.jobs.get(clean);
    const path = this.jobPath(clean);
    if (!existsSync(path)) throw new Error(`unknown execution job: ${clean}`);
    return JSON.parse(readFileSync(path, "utf8"));
  }

  failPersistedJob(id, error) {
    const job = this.getJob(id);
    job.status = "failed";
    job.ended_at = Date.now();
    job.output = error instanceof Error ? error.message : String(error);
    this.saveJob(job);
    return job;
  }

  kernel(language, machineId, cwd) {
    const key = `${this.sessionId}:${cleanId(machineId, "worker-0")}:${language}:${cwd}`;
    let kernel = this.kernels.get(key);
    if (!kernel) {
      kernel = new PersistentKernel({ language, cwd });
      this.kernels.set(key, kernel);
    }
    return kernel;
  }

  runProcess(command, cwd, timeoutMs) {
    const shell = process.platform === "win32"
      ? { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] }
      : { file: "/bin/sh", args: ["-c", command] };
    return new Promise((resolvePromise) => {
      execFile(
        shell.file,
        shell.args,
        { cwd, timeout: timeoutMs, maxBuffer: MAX_CAPTURE_BYTES, windowsHide: true },
        (error, stdout, stderr) => {
          resolvePromise({
            ok: !error,
            stdout: [stdout, stderr].filter(Boolean).join("\n").slice(0, MAX_CAPTURE_BYTES),
            result: null,
            error: error ? error.message : null,
          });
        },
      );
    });
  }

  notebookPath(machineId, language) {
    const name = `${cleanId(machineId, "worker-0")}-${language}.ipynb`;
    return join(this.workspaceRoot, STORE_DIR, TRACE_DIR, name);
  }

  appendNotebook(machineId, language, input, result, job) {
    const path = this.notebookPath(machineId, language);
    const previous = this.notebookQueues.get(path) ?? Promise.resolve();
    const next = previous.then(() => withDirectoryLock(`${path}.lock`, () => {
        let notebook = emptyNotebook(language);
        if (existsSync(path)) {
          try {
            const parsed = JSON.parse(readFileSync(path, "utf8"));
            if (Array.isArray(parsed.cells)) notebook = parsed;
          } catch {
            throw new Error(`invalid execution notebook: ${relative(this.workspaceRoot, path)}`);
          }
        }
        notebook.cells.push({
          cell_type: "code",
          source: input.code,
          outputs: outputCells(result),
          execution_count: null,
          metadata: {
            apex_discovery: {
              human_description: input.human_description,
              environment: input.environment,
              session_id: this.sessionId,
              job_id: job.id,
              started_at: job.started_at,
              ended_at: job.ended_at,
              status: job.status,
            },
          },
        });
        atomicWrite(path, JSON.stringify(notebook, null, 1));
      }));
    this.notebookQueues.set(path, next.catch(() => undefined));
    return next.then(() => relative(this.workspaceRoot, path));
  }

  async finishJob(job, input, runner, { notebook = false } = {}) {
    let result;
    try {
      result = boundedResult(await runner());
    } catch (error) {
      result = { ok: false, stdout: "", result: null, error: error instanceof Error ? error.message : String(error) };
    }
    job.status = result.ok ? "completed" : "failed";
    job.ended_at = Date.now();
    job.output = outputText(result);
    if (notebook) {
      try {
        job.notebook_path = await this.appendNotebook(input.machine_id, input.language, input, result, job);
      } catch (error) {
        job.status = "failed";
        job.output = [job.output, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n");
      }
    }
    this.saveJob(job);
    this.audit({
      schema_version: 1,
      ts: Math.floor(job.started_at / 1000),
      session_id: this.sessionId,
      job_id: job.id,
      tool: job.tool,
      human_description: input.human_description,
      language: input.language,
      environment: input.environment,
      working_dir: input.working_dir,
      status: job.status,
      wall_ms: job.ended_at - job.started_at,
      content_sha256: createHash("sha256").update(input.code ?? input.command).digest("hex"),
      notebook_path: job.notebook_path ?? null,
    });
    return job;
  }

  startJob(tool, input, runner, options) {
    const job = {
      id: input.internal_job_id || `job_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      tool,
      human_description: input.human_description,
      status: "running",
      started_at: Date.now(),
      ended_at: null,
      output: "",
      notebook_path: null,
      ...(input.internal_job_id ? { background: true } : {}),
    };
    this.saveJob(job);
    const done = this.finishJob(job, input, runner, options);
    return done;
  }

  startDetached(tool, input) {
    const job = {
      id: `job_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      tool,
      human_description: input.human_description,
      status: "running",
      started_at: Date.now(),
      ended_at: null,
      output: "",
      notebook_path: null,
      background: true,
    };
    this.saveJob(job);
    const requestPath = join(this.workspaceRoot, STORE_DIR, JOB_DIR, `${job.id}.request.json`);
    atomicWrite(requestPath, JSON.stringify({
      workspace_root: this.workspaceRoot,
      session_id: this.sessionId,
      job_id: job.id,
      tool,
      input: { ...input, run_in_background: false },
    }));
    try {
      const child = spawn(process.execPath, [join(SOURCE_DIR, "science-job-worker.mjs"), requestPath], {
        cwd: this.workspaceRoot,
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.once("error", (error) => this.failPersistedJob(job.id, error));
      child.unref();
    } catch (error) {
      return Promise.resolve(this.failPersistedJob(job.id, error));
    }
    return Promise.resolve(job);
  }

  runBash(rawInput) {
    this.assertAllowed();
    const input = {
      command: String(rawInput.command || ""),
      human_description: validateHumanDescription(rawInput.human_description),
      environment: String(rawInput.environment || "workspace"),
      working_dir: String(rawInput.working_dir || "."),
      timeout_minutes: Number(rawInput.timeout_minutes ?? 20),
      run_in_background: Boolean(rawInput.run_in_background),
      machine_id: cleanId(rawInput.machine_id, "worker-0"),
      internal_job_id: cleanId(rawInput.internal_job_id, ""),
    };
    if (!input.command.trim()) throw new Error("command is required");
    assertInputSize(input.command, "command");
    if (input.environment !== "workspace") throw new Error("only the workspace environment is available in v1");
    if (!Number.isInteger(input.timeout_minutes) || input.timeout_minutes < 1 || input.timeout_minutes > 60) {
      throw new Error("timeout_minutes must be an integer from 1 to 60");
    }
    const cwd = workspacePath(this.workspaceRoot, input.working_dir);
    if (input.run_in_background) return this.startDetached("Bash", input);
    return this.startJob(
      "Bash",
      { ...input, code: input.command, language: "bash" },
      () => this.runProcess(input.command, cwd, input.timeout_minutes * 60_000),
      { notebook: false },
    );
  }

  runCode(rawInput) {
    this.assertAllowed();
    const input = {
      code: String(rawInput.code || ""),
      language: String(rawInput.language || "python").toLowerCase(),
      human_description: validateHumanDescription(rawInput.human_description),
      environment: String(rawInput.environment || "workspace"),
      working_dir: String(rawInput.working_dir || "."),
      timeout_minutes: Number(rawInput.timeout_minutes ?? 20),
      run_in_background: Boolean(rawInput.run_in_background),
      machine_id: cleanId(rawInput.machine_id, "worker-0"),
      internal_job_id: cleanId(rawInput.internal_job_id, ""),
    };
    if (!input.code.trim()) throw new Error("code is required");
    assertInputSize(input.code, "code");
    assertInlineNotebookCode(input.code, input.language);
    if (!["python", "r"].includes(input.language)) {
      throw new Error("ExecuteCode language must be python or r; use Bash for CLI and shell commands");
    }
    if (input.environment !== "workspace") throw new Error("only the workspace environment is available in v1");
    if (!Number.isInteger(input.timeout_minutes) || input.timeout_minutes < 1 || input.timeout_minutes > 60) {
      throw new Error("timeout_minutes must be an integer from 1 to 60");
    }
    const cwd = workspacePath(this.workspaceRoot, input.working_dir);
    if (input.run_in_background) return this.startDetached("ExecuteCode", input);
    const runner = () => this.kernel(input.language, input.machine_id, cwd)
      .execute(input.code, input.timeout_minutes * 60_000);
    return this.startJob("ExecuteCode", input, runner, { notebook: true });
  }

  close() {
    for (const kernel of this.kernels.values()) kernel.stop();
    this.kernels.clear();
  }
}
