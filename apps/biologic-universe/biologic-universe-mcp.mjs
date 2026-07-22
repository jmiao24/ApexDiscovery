#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BiologicUniverse } from "./biologic-universe-query.mjs";

const dataPath = process.env.BIOLOGIC_UNIVERSE_DATA_PATH;
if (!dataPath) throw new Error("BIOLOGIC_UNIVERSE_DATA_PATH is required");

const universe = await BiologicUniverse.fromFile(dataPath);
const server = new McpServer({ name: "biologic-universe", version: "0.1.0" });

server.registerTool(
  "BiologicUniverseQuery",
  {
    title: "Biologic Universe Query",
    description: "Query a fixed biologic asset snapshot. Use this tool for every factual claim about assets, targets, modalities, phases, regions, repurposing candidates, or evidence in the dashboard. Result sets are bounded to 20 records; larger requested limits are clamped automatically and reported in query_limit.",
    inputSchema: z.object({
      operation: z.enum(["summary", "search_assets", "target_profile", "repurposing", "modality_gaps", "compare_assets", "evidence"]),
      query: z.string().max(500).optional(),
      targets: z.array(z.string()).max(20).optional(),
      modalities: z.array(z.string()).max(20).optional(),
      phases: z.array(z.string()).max(20).optional(),
      regions: z.array(z.string()).max(20).optional(),
      stopped: z.boolean().optional(),
      asset_ids: z.array(z.string()).max(20).optional(),
      limit: z.number().int().min(1).optional(),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const requestedLimit = input.limit ?? 10;
    const appliedLimit = Math.min(20, requestedLimit);
    const result = {
      ...universe.query({ ...input, limit: appliedLimit }),
      query_limit: {
        requested: requestedLimit,
        applied: appliedLimit,
        clamped: requestedLimit !== appliedLimit,
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
);

await server.connect(new StdioServerTransport());
