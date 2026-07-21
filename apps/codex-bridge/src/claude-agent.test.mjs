import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaudeAgentOptions,
  claudeAgentVisibleTools,
  claudeAuthentication,
  normalizeClaudeMessage,
  runClaudeAgent,
  toClaudeMcpServers,
} from "./claude-agent.mjs";

test("presents APEX execution as Bash and ExecuteCode instead of a redundant MCP label", () => {
  assert.deepEqual(
    claudeAgentVisibleTools({
      apex_execution: { type: "stdio", command: "node" },
      clinical_data: { type: "http", url: "https://example.test/mcp" },
    }),
    [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch",
      "Bash",
      "ExecuteCode",
      "MCP · clinical_data",
    ],
  );
});

test("converts local and remote APEX MCP servers", () => {
  assert.deepEqual(toClaudeMcpServers({
    local: { type: "local", command: ["node", "server.mjs"], environment: { TOKEN: "$env:SECRET" } },
    remote: { type: "remote", url: "https://example.test/mcp", headers: { Authorization: "${AUTH}" } },
    off: { type: "remote", url: "https://off.test", enabled: false },
  }, { SECRET: "one", AUTH: "two" }), {
    local: { type: "stdio", command: "node", args: ["server.mjs"], env: { TOKEN: "one" } },
    remote: { type: "http", url: "https://example.test/mcp", headers: { Authorization: "two" } },
  });
});

test("isolates Claude settings and removes nested-agent tools", () => {
  const options = buildClaudeAgentOptions({
    apiKey: "test-key",
    cwd: "/tmp/workspace",
    systemPrompt: "APEX",
    mcpServers: {
      data: { type: "http", url: "https://example.test/mcp" },
      apex_execution: { type: "stdio", command: "node", args: ["science-mcp.mjs"] },
    },
    env: { PATH: "/bin", OPENAI_API_KEY: "main-secret" },
  });
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(options.disallowedTools, ["Agent", "Task"]);
  assert.equal(options.tools.includes("WebSearch"), true);
  assert.equal(options.allowedTools.includes("mcp__data__*"), true);
  assert.equal(options.toolAliases.Bash, "mcp__apex_execution__Bash");
  assert.equal(options.toolAliases.ExecuteCode, "mcp__apex_execution__ExecuteCode");
  assert.equal(options.permissionMode, "acceptEdits");
  assert.equal(options.env.ANTHROPIC_API_KEY, "test-key");
  assert.equal(options.env.OPENAI_API_KEY, undefined);
});

test("subscription mode requires and uses an explicit local Claude executable", () => {
  const auth = claudeAuthentication({
    env: {
      APEX_CLAUDE_AUTH: "subscription",
      APEX_CLAUDE_EXECUTABLE: "/custom/claude",
      ANTHROPIC_API_KEY: "must-not-leak",
    },
  });
  assert.equal(auth.mode, "subscription");
  assert.equal(auth.pathToClaudeCodeExecutable, "/custom/claude");
  assert.equal(auth.env.ANTHROPIC_API_KEY, undefined);
});

test("normalizes Claude text, tools, results, and runs an injected stream", async () => {
  const messages = [
    { type: "system", subtype: "init", session_id: "claude-1", model: "sonnet", tools: [] },
    { type: "assistant", message: { content: [
      { type: "text", text: "Working" },
      { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a.txt" } },
    ] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }] } },
    { type: "result", subtype: "success", session_id: "claude-1", result: "Memo", is_error: false },
  ];
  assert.deepEqual(normalizeClaudeMessage(messages[1])[1], {
    type: "tool-start", id: "tool-1", name: "Read", input: { file_path: "a.txt" },
  });
  const events = [];
  const result = await runClaudeAgent({
    prompt: "task",
    options: {},
    query: () => (async function* () { yield* messages; })(),
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.result, "Memo");
  assert.equal(result.sessionId, "claude-1");
  assert.equal(events.some((event) => event.type === "tool-result"), true);
});
