import assert from "node:assert/strict";
import test from "node:test";
import { apexExecutionMcpConfig, mainCodexConfig } from "./codex-client-config.mjs";

test("keeps native command execution beside notebook-first APEX execution", () => {
  assert.deepEqual(
    mainCodexConfig({
      mcpServers: { apex_execution: { command: "node", args: ["science-mcp.mjs"] } },
      hasApexExecution: true,
    }),
    {
      mcp_servers: { apex_execution: { command: "node", args: ["science-mcp.mjs"] } },
    },
  );
});

test("keeps the native Codex shell when no APEX execution replacement exists", () => {
  assert.deepEqual(
    mainCodexConfig({ mcpServers: {}, hasApexExecution: false }),
    { mcp_servers: {} },
  );
});

test("disables nested subagents without removing the shared APEX tools", () => {
  assert.deepEqual(
    mainCodexConfig({
      mcpServers: { apex_execution: { command: "node", args: ["science-mcp.mjs"] } },
      hasApexExecution: true,
      allowSubagents: false,
    }),
    {
      mcp_servers: { apex_execution: { command: "node", args: ["science-mcp.mjs"] } },
      features: { multi_agent: false },
    },
  );
});

test("registers sandboxed APEX execution in WorkspaceWrite mode", () => {
  const execution = apexExecutionMcpConfig({
    processPath: "/usr/bin/node",
    scienceMcpPath: "/app/science-mcp.mjs",
    workspaceRoot: "/workspace/project",
    sessionId: "ses_123",
    executionMode: "workspace-write",
  });
  assert.deepEqual(execution, {
    apex_execution: {
      command: "/usr/bin/node",
      args: ["/app/science-mcp.mjs"],
      env: {
        APEX_WORKSPACE_ROOT: "/workspace/project",
        APEX_SESSION_ID: "ses_123",
        APEX_EXECUTION_MODE: "workspace-write",
      },
      enabled: true,
      default_tools_approval_mode: "writes",
    },
  });
  assert.deepEqual(mainCodexConfig({ mcpServers: execution, hasApexExecution: true }), {
    mcp_servers: execution,
  });
});

test("rejects an execution mode without a safe runtime contract", () => {
  assert.throws(
    () => apexExecutionMcpConfig({
      processPath: "/usr/bin/node",
      scienceMcpPath: "/app/science-mcp.mjs",
      workspaceRoot: "/workspace/project",
      sessionId: "ses_123",
      executionMode: "read-only",
    }),
    /unsupported APEX execution mode/,
  );
});
