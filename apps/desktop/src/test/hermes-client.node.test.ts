// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { HermesClient, type GatewayEvent, type SocketLike } from "@ai4s/sdk";
import { startMockGateway, type MockGateway } from "@ai4s/sdk/mock-gateway";

let gateway: MockGateway;

beforeAll(async () => {
  gateway = await startMockGateway(0);
});
afterAll(async () => {
  await gateway.close();
});

async function waitFor(pred: () => boolean, timeout = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("HermesClient ↔ Hermes-protocol Gateway", () => {
  it("connects, creates a session, sends a prompt, and streams agent events", async () => {
    const events: GatewayEvent[] = [];
    const client = new HermesClient({
      url: `ws://127.0.0.1:${gateway.port}`,
      socketFactory: (url) => new WebSocket(url) as unknown as SocketLike,
    });
    client.onEvent((e) => events.push(e));

    await client.connect();
    expect(client.getStatus()).toBe("ready");

    const sessionId = await client.createSession();
    expect(sessionId).toBe("mock-session-1");

    await client.sendPrompt(sessionId, "run a literature review");
    await waitFor(() => events.some((e) => e.type === "session.done"));

    const types = events.map((e) => e.type);
    expect(types).toContain("message.delta");
    expect(types).toContain("tool.start");
    expect(types).toContain("tool.complete");

    const toolDone = events.find((e) => e.type === "tool.complete");
    expect(toolDone && "status" in toolDone && toolDone.status).toBe("success");

    client.close();
    expect(client.getStatus()).toBe("offline");
  });

  it("rejects requests when not connected", async () => {
    const client = new HermesClient({
      url: `ws://127.0.0.1:${gateway.port}`,
      socketFactory: (url) => new WebSocket(url) as unknown as SocketLike,
    });
    await expect(client.createSession()).rejects.toThrow(/Not connected/);
  });
});
