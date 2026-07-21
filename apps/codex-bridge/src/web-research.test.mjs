import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWebResearch, OpenAIWebResearch } from "./web-research.mjs";

const responsePayload = {
  id: "resp_1",
  model: "gpt-test",
  output: [
    {
      type: "web_search_call",
      action: { sources: [{ url: "https://example.org/a" }, { url: "https://example.org/b" }] },
    },
    {
      type: "message",
      content: [{
        type: "output_text",
        text: "MC4R has supported evidence.",
        annotations: [{
          type: "url_citation",
          url: "https://example.org/a",
          title: "Primary evidence",
          start_index: 0,
          end_index: 28,
        }],
      }],
    },
  ],
};

test("normalizes answer, citations, complete sources, and timing", () => {
  const result = normalizeWebResearch(responsePayload, {
    kind: "search",
    query: "MC4R evidence",
    maxResults: 8,
    durationMs: 42.4,
  });
  assert.equal(result.answer, "MC4R has supported evidence.");
  assert.equal(result.result_count, 2);
  assert.equal(result.duration_ms, 42);
  assert.deepEqual(result.sources, [
    {
      title: "Primary evidence",
      url: "https://example.org/a",
      context: "MC4R has supported evidence.",
    },
    { title: "example.org", url: "https://example.org/b" },
  ]);
});

test("submits WebSearch with source inclusion and domain filters", async () => {
  let request;
  const client = new OpenAIWebResearch({
    apiKey: "test-key",
    model: "gpt-test",
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify(responsePayload), { status: 200 });
    },
  });
  const result = await client.search({
    query: "MC4R evidence",
    allowedDomains: ["nih.gov"],
    maxResults: 1,
  });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.init.headers.authorization, "Bearer test-key");
  assert.deepEqual(request.body.include, ["web_search_call.action.sources"]);
  assert.deepEqual(request.body.tools[0].filters.allowed_domains, ["nih.gov"]);
  assert.equal(result.sources.length, 1);
});

test("WebFetch restricts research to the exact URL host", async () => {
  let body;
  const client = new OpenAIWebResearch({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify(responsePayload), { status: 200 });
    },
  });
  const result = await client.fetch({ url: "https://www.fda.gov/drugs/label", maxResults: 8 });
  assert.deepEqual(body.tools[0].filters.allowed_domains, ["fda.gov"]);
  assert.match(body.input, /exact URL/);
  assert.equal(result.kind, "fetch");
});
