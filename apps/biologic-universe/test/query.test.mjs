import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BiologicUniverse } from "../biologic-universe-query.mjs";

const dataPath = join(dirname(fileURLToPath(import.meta.url)), "../results/prod_batch_001/viz/showcase_data.json");
const universe = await BiologicUniverse.fromFile(dataPath);

test("returns a bounded universe summary", () => {
  const result = universe.query({ operation: "summary" });
  assert.equal(result.snapshot.run, "prod_batch_001");
  assert.ok(result.snapshot.targetable_proteins > 4000);
  assert.ok(result.snapshot.citations > 10000);
});

test("finds an exact target profile with assets and sources", () => {
  const result = universe.query({ operation: "target_profile", targets: ["TNFRSF17"], limit: 5 });
  assert.equal(result.target.symbol, "TNFRSF17");
  assert.ok(result.result_count > 0);
  assert.ok(result.results.length <= 5);
  assert.ok(result.results.some((item) => item.sources.some((source) => source.url)));
  assert.ok(result.evidence.some((item) => item.url));
});

test("searches assets without returning the full universe", () => {
  const result = universe.query({ operation: "search_assets", query: "CAR-T", limit: 4 });
  assert.ok(result.result_count > 0);
  assert.ok(result.results.length <= 4);
});

test("returns modality gaps for one target", () => {
  const symbol = universe.data.modgap.grid[0].sym;
  const result = universe.query({ operation: "modality_gaps", targets: [symbol], limit: 3 });
  assert.ok(result.results.length <= 1);
  assert.equal(result.results[0]?.target, symbol);
});
