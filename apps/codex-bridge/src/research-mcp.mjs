#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OpenAIWebResearch } from "./web-research.mjs";

const research = new OpenAIWebResearch();
const server = new McpServer({ name: "apex-discovery-research", version: "1.0.0" });
const humanDescription = z.string().min(3).max(120).describe(
  "Required distinct 3-8 word action label, such as 'Checking FDA setmelanotide labeling'",
);
const maxResults = z.number().int().min(1).max(12).default(8);

function response(result) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

server.registerTool(
  "WebSearch",
  {
    title: "WebSearch",
    description:
      "Search the live web and return an evidence-focused synthesis with complete clickable source URLs. Use WebFetch instead when the user or prior research provides an exact URL.",
    inputSchema: z.object({
      human_description: humanDescription,
      query: z.string().min(2).max(1000),
      allowed_domains: z.array(z.string().min(1)).max(20).default([]),
      max_results: maxResults,
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async ({ human_description: _label, query, allowed_domains, max_results }) =>
    response(await research.search({ query, allowedDomains: allowed_domains, maxResults: max_results })),
);

server.registerTool(
  "WebFetch",
  {
    title: "WebFetch",
    description:
      "Open and summarize one exact public HTTP(S) URL, preserving that URL and the supporting sources for inspection. Do not use it for broad discovery queries.",
    inputSchema: z.object({
      human_description: humanDescription,
      url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "URL must use HTTP or HTTPS"),
      max_results: maxResults,
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async ({ human_description: _label, url, max_results }) =>
    response(await research.fetch({ url, maxResults: max_results })),
);

await server.connect(new StdioServerTransport());
