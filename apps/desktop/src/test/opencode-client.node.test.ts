// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenCodeClient, type OpenCodeEvent } from "@ai4s/sdk";
import { startMockOpenCode, type MockOpenCode } from "@ai4s/sdk/mock-server";

let server: MockOpenCode;

beforeAll(async () => {
  server = await startMockOpenCode(0);
});
afterAll(async () => {
  await server.close();
});

async function waitFor(pred: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("OpenCodeClient ↔ OpenCode server", () => {
  it("connects, creates a session, sends a prompt, and streams normalized events", async () => {
    const events: OpenCodeEvent[] = [];
    const client = new OpenCodeClient({ baseUrl: `http://127.0.0.1:${server.port}` });
    client.onEvent((e) => events.push(e));

    await client.connect();
    expect(client.getStatus()).toBe("ready");

    const sessionId = await client.createSession();
    expect(sessionId).toBe("ses_mock");

    await client.sendPrompt(sessionId, "run a literature review");
    await waitFor(() => events.some((e) => e.type === "session.idle"));

    const types = events.map((e) => e.type);
    expect(types).toContain("text.updated");
    expect(types).toContain("tool.updated");

    const toolDone = events.find(
      (e): e is Extract<OpenCodeEvent, { type: "tool.updated" }> =>
        e.type === "tool.updated" && e.status === "success",
    );
    expect(toolDone?.title).toContain("literature-search");

    client.close();
    expect(client.getStatus()).toBe("offline");
  });

  it("reports an error status when the server is unreachable", async () => {
    const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:1" });
    await expect(client.connect()).rejects.toBeTruthy();
    expect(client.getStatus()).toBe("error");
  });
});
