import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";

const BUILTIN_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"];
const NESTED_AGENT_TOOLS = ["Agent", "Task"];

function resolveEnvironmentValue(value, env) {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("$env:")) return env[value.slice(5)];
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  return match ? env[match[1]] : value;
}

/** Convert APEX's normalized MCP catalog to the Claude Agent SDK schema. */
export function toClaudeMcpServers(servers, env = process.env) {
  const result = {};
  for (const [name, server] of Object.entries(servers ?? {})) {
    if (!server || server.enabled === false) continue;
    if (server.type === "local" && Array.isArray(server.command) && server.command.length) {
      const resolvedEnv = Object.fromEntries(
        Object.entries(server.environment ?? {})
          .map(([key, value]) => [key, resolveEnvironmentValue(value, env)])
          .filter(([, value]) => typeof value === "string"),
      );
      result[name] = {
        type: "stdio",
        command: server.command[0],
        args: server.command.slice(1),
        ...(Object.keys(resolvedEnv).length ? { env: resolvedEnv } : {}),
      };
    } else if (server.type === "remote" && typeof server.url === "string") {
      const headers = Object.fromEntries(
        Object.entries(server.headers ?? {})
          .map(([key, value]) => [key, resolveEnvironmentValue(value, env)])
          .filter(([, value]) => typeof value === "string"),
      );
      result[name] = {
        type: "http",
        url: server.url,
        ...(Object.keys(headers).length ? { headers } : {}),
      };
    }
  }
  return result;
}

function localClaudeExecutable(env = process.env) {
  const configured = env.APEX_CLAUDE_EXECUTABLE?.trim();
  if (configured) return configured;
  const candidates = process.platform === "win32"
    ? [join(homedir(), ".local", "bin", "claude.exe")]
    : [join(homedir(), ".local", "bin", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
  return candidates.find((path) => existsSync(path)) ?? null;
}

export function claudeAuthentication({ apiKey, env = process.env } = {}) {
  const mode = env.APEX_CLAUDE_AUTH === "subscription" ? "subscription" : "api-key";
  const childEnv = { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: "apex-science/0.1" };
  // The Claude process needs ordinary runtime configuration (PATH, HOME,
  // proxies), not credentials belonging to the Main Agent or app server. MCP
  // credentials are passed only in each server's own env/headers configuration.
  for (const key of Object.keys(childEnv)) {
    if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) {
      delete childEnv[key];
    }
  }
  if (mode === "subscription") {
    const executable = localClaudeExecutable(env);
    if (!executable) {
      throw new Error("Claude subscription testing requires a local Claude CLI; install it or set APEX_CLAUDE_EXECUTABLE");
    }
    // API credentials take precedence over the user's local Claude login. The
    // explicit development mode must therefore remove them from this child.
    return { mode, env: childEnv, pathToClaudeCodeExecutable: executable };
  }
  const key = apiKey?.trim() || env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("Claude Agent requires ANTHROPIC_API_KEY (or APEX_CLAUDE_AUTH=subscription for local testing)");
  childEnv.ANTHROPIC_API_KEY = key;
  return { mode, env: childEnv };
}

export function buildClaudeAgentOptions({
  apiKey,
  cwd,
  systemPrompt,
  mcpServers = {},
  fullAccess = false,
  abortController,
  model,
  env = process.env,
} = {}) {
  const auth = claudeAuthentication({ apiKey, env });
  const mcpToolWildcards = Object.keys(mcpServers).map((name) => `mcp__${name}__*`);
  const hasApexExecution = "apex_execution" in mcpServers;
  return {
    cwd,
    systemPrompt,
    tools: BUILTIN_TOOLS,
    allowedTools: [...BUILTIN_TOOLS, ...mcpToolWildcards],
    disallowedTools: NESTED_AGENT_TOOLS,
    ...(hasApexExecution ? {
      toolAliases: {
        Bash: "mcp__apex_execution__Bash",
        ExecuteCode: "mcp__apex_execution__ExecuteCode",
      },
    } : {}),
    mcpServers,
    strictMcpConfig: true,
    settingSources: [],
    permissionMode: fullAccess ? "bypassPermissions" : "acceptEdits",
    ...(fullAccess ? { allowDangerouslySkipPermissions: true } : {}),
    sandbox: {
      enabled: !fullAccess,
      autoAllowBashIfSandboxed: false,
      failIfUnavailable: false,
    },
    maxTurns: 30,
    ...(model ? { model } : {}),
    ...(abortController ? { abortController } : {}),
    env: auth.env,
    ...(auth.pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable: auth.pathToClaudeCodeExecutable } : {}),
  };
}

function contentBlocks(message) {
  return Array.isArray(message?.message?.content) ? message.message.content : [];
}

export function normalizeClaudeMessage(message) {
  if (!message || typeof message !== "object") return [];
  if (message.type === "system" && message.subtype === "init") {
    return [{ type: "session", sessionId: message.session_id, model: message.model, tools: message.tools ?? [] }];
  }
  if (message.type === "assistant") {
    return contentBlocks(message).flatMap((block) => {
      if (block?.type === "text" && typeof block.text === "string") {
        return [{ type: "text", text: block.text }];
      }
      if (block?.type === "tool_use") {
        return [{ type: "tool-start", id: block.id, name: block.name, input: block.input ?? {} }];
      }
      return [];
    });
  }
  if (message.type === "user") {
    return contentBlocks(message).flatMap((block) => block?.type === "tool_result"
      ? [{
          type: "tool-result",
          id: block.tool_use_id,
          error: Boolean(block.is_error),
          output: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""),
        }]
      : []);
  }
  if (message.type === "result") {
    return [{
      type: "result",
      sessionId: message.session_id,
      error: message.subtype !== "success" || Boolean(message.is_error),
      result: message.subtype === "success" ? message.result : (message.errors ?? []).join("\n"),
    }];
  }
  return [];
}

/** Run a Claude child and surface a small provider-neutral activity stream. */
export async function runClaudeAgent({ prompt, options, onEvent, query = sdkQuery }) {
  let finalResult = "";
  let failed = null;
  let sessionId = null;
  const stream = query({ prompt, options });
  for await (const message of stream) {
    for (const event of normalizeClaudeMessage(message)) {
      if (event.type === "session") sessionId = event.sessionId;
      if (event.type === "result") {
        finalResult = event.result || finalResult;
        if (event.error) failed = event.result || "Claude Agent failed";
      }
      await onEvent?.(event);
    }
  }
  return { result: finalResult, failed, sessionId };
}

export const CLAUDE_AGENT_BUILTIN_TOOLS = [...BUILTIN_TOOLS];

/** User-facing capability labels for the Claude child card.
 * `apex_execution` is an implementation detail represented by its Bash and
 * ExecuteCode aliases, while user-configured MCP servers remain visible. */
export function claudeAgentVisibleTools(mcpServers = {}) {
  const serverNames = Object.keys(mcpServers);
  return [
    ...BUILTIN_TOOLS,
    ...(serverNames.includes("apex_execution") ? ["Bash", "ExecuteCode"] : []),
    ...serverNames
      .filter((name) => name !== "apex_execution")
      .map((name) => `MCP · ${name}`),
  ];
}
