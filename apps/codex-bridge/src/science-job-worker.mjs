#!/usr/bin/env node
import { readFileSync, rmSync } from "node:fs";
import { ScienceExecutionRuntime } from "./science-execution.mjs";

const requestPath = process.argv[2];
if (!requestPath) process.exit(2);

let runtime;
let request;
try {
  request = JSON.parse(readFileSync(requestPath, "utf8"));
  runtime = new ScienceExecutionRuntime({
    workspaceRoot: request.workspace_root,
    sessionId: request.session_id,
    allowExecution: true,
  });
  const input = {
    ...request.input,
    run_in_background: false,
    internal_job_id: request.job_id,
  };
  if (request.tool === "Bash") await runtime.runBash(input);
  else if (request.tool === "ExecuteCode") await runtime.runCode(input);
  else throw new Error(`unsupported background tool: ${request.tool}`);
} catch (error) {
  if (runtime && request?.job_id) runtime.failPersistedJob(request.job_id, error);
} finally {
  runtime?.close();
  rmSync(requestPath, { force: true });
}
