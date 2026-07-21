#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const callbackUrl = process.env.APEX_CLAUDE_CALLBACK_URL;
const callbackToken = process.env.APEX_CLAUDE_INTERNAL_TOKEN;
const parentSessionId = process.env.APEX_PARENT_SESSION_ID;

if (!callbackUrl || !callbackToken || !parentSessionId) {
  throw new Error("Claude Agent launcher is missing its private APEX callback configuration");
}

const server = new McpServer({ name: "apex-claude-agent", version: "1.0.0" });

server.registerTool(
  "LaunchClaudeAgent",
  {
    title: "Launch Claude Agent",
    description:
      "Delegate a concrete independent task to a Claude Agent SDK child. The child has the Main Agent's workspace, skills, web, execution, and configured MCP capabilities, but cannot launch another subagent. Use this for a genuinely useful parallel or independent analysis, not as a substitute for ordinary tool calls.",
    inputSchema: z.object({
      human_description: z.string().min(1).max(120)
        .describe("Required 3-8 word action label, such as 'Delegating target safety assessment'"),
      task: z.string().min(1).max(50_000).describe("Self-contained delegated task and expected deliverable"),
      skills: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)).max(20).default([])
        .describe("APEX skill names the child should load before working"),
    }).strict(),
  },
  async (input) => {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${callbackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parentSessionId, ...input }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.data?.message ?? payload?.message ?? `Claude Agent callback failed (${response.status})`;
      return { content: [{ type: "text", text: message }], isError: true };
    }
    return {
      content: [{ type: "text", text: payload.memo ?? "Claude Agent returned no memo" }],
      structuredContent: payload,
      isError: Boolean(payload.failed),
    };
  },
);

await server.connect(new StdioServerTransport());
