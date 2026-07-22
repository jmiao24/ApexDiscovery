import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("exposes one read-only bounded universe tool", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "biologic-universe-mcp.mjs")],
    env: {
      ...process.env,
      BIOLOGIC_UNIVERSE_DATA_PATH: join(root, "results/prod_batch_001/viz/showcase_data.json"),
    },
  });
  const client = new Client({ name: "biologic-universe-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["BiologicUniverseQuery"]);
    assert.equal(tools.tools[0].annotations.readOnlyHint, true);

    const response = await client.callTool({
      name: "BiologicUniverseQuery",
      arguments: { operation: "search_assets", query: "CAR-T", limit: 3 },
    });
    assert.equal(response.isError, undefined);
    assert.ok(response.structuredContent.result_count > 0);
    assert.ok(response.structuredContent.results.length <= 3);

    const oversized = await client.callTool({
      name: "BiologicUniverseQuery",
      arguments: { operation: "target_profile", targets: ["PCSK9"], limit: 100 },
    });
    assert.equal(oversized.isError, undefined);
    assert.deepEqual(oversized.structuredContent.query_limit, {
      requested: 100,
      applied: 20,
      clamped: true,
    });
    assert.ok(oversized.structuredContent.results.length <= 20);
  } finally {
    await client.close();
  }
});
