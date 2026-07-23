#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ScienceExecutionRuntime } from "./science-execution.mjs";

const runtime = new ScienceExecutionRuntime({
  workspaceRoot: process.env.APEX_WORKSPACE_ROOT,
  sessionId: process.env.APEX_SESSION_ID,
  executionMode: process.env.APEX_EXECUTION_MODE || "disabled",
});

const server = new McpServer({ name: "apex-discovery-execution", version: "1.0.0" });
const description = z
  .string()
  .min(1)
  .max(120)
  .describe("Required 3-8 word action label shown to the user, such as 'Querying MC4R target associations'");
const common = {
  human_description: description,
  environment: z.literal("workspace").describe("Execution environment; v1 supports the active workspace environment"),
  working_dir: z.string().default(".").describe("Workspace-relative existing directory"),
  timeout_minutes: z.number().int().min(1).max(60).default(20),
  run_in_background: z.boolean().default(false),
  machine_id: z.string().default("worker-0").describe("Kernel/job isolation key"),
};

function response(job) {
  return {
    content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
    structuredContent: job,
    isError: job.status === "failed",
  };
}

server.registerTool(
  "Bash",
  {
    title: "Bash",
    description:
      "Run disposable diagnostics, package installation, and one-shot shell commands. Do not use it for formal data analysis. Each call uses a fresh process, is security-audited, and is never added to the reproducibility notebook.",
    inputSchema: z.object({
      command: z.string().min(1).describe("One-shot shell command; not a formal analysis program"),
      ...common,
    }).strict(),
  },
  async (input) => response(await runtime.runBash(input)),
);

server.registerTool(
  "ExecuteCode",
  {
    title: "ExecuteCode",
    description:
      "Run notebook-first Python or R analysis. Put complete code for the current logical step directly in the code argument; never stage analysis in a script and execute that script here. Foreground kernels persist across calls in the active task runtime, and every call and output is appended to a reproducibility notebook. Use Bash for every CLI or shell command.",
    inputSchema: z.object({
      code: z.string().min(1).describe("Complete inline code for one reproducible notebook step; staged script loaders are rejected"),
      language: z.enum(["python", "r"]).default("python"),
      ...common,
    }).strict(),
  },
  async (input) => response(await runtime.runCode(input)),
);

server.registerTool(
  "GetExecutionJob",
  {
    title: "Get execution job",
    description: "Read the persisted status and output of a background APEX execution job.",
    inputSchema: z.object({ job_id: z.string().min(1) }).strict(),
  },
  async ({ job_id }) => response(runtime.getJob(job_id)),
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    runtime.close();
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
