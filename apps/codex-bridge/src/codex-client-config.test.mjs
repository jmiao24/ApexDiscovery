import assert from "node:assert/strict";
import test from "node:test";
import { mainCodexConfig } from "./codex-client-config.mjs";

test("disables the native Codex shell when APEX execution is available", () => {
  assert.deepEqual(
    mainCodexConfig({
      mcpServers: { apex_execution: { command: "node", args: ["science-mcp.mjs"] } },
      hasApexExecution: true,
    }),
    {
      mcp_servers: { apex_execution: { command: "node", args: ["science-mcp.mjs"] } },
      features: { shell_tool: false },
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
      features: { shell_tool: false, multi_agent: false },
    },
  );
});
