// A minimal Hermes-protocol Gateway for tests and local dev. Node-only (uses `ws`).
// It implements the documented JSON-RPC contract and streams a simulated agent
// turn so the desktop integration can be exercised without the real Hermes binary.
import { WebSocketServer, type WebSocket } from "ws";

export interface MockGateway {
  port: number;
  close: () => Promise<void>;
}

export function startMockGateway(port = 0): Promise<MockGateway> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port });
    wss.on("connection", (ws: WebSocket) => {
      ws.on("message", (data: Buffer) => handle(ws, data.toString()));
    });
    wss.on("listening", () => {
      const addr = wss.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () =>
          new Promise((res) => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => res());
          }),
      });
    });
  });
}

function reply(ws: WebSocket, id: number, result: unknown): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}
function notify(ws: WebSocket, method: string, params: Record<string, unknown>): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

function handle(ws: WebSocket, raw: string): void {
  let msg: { id?: number; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.method === "session.create" && typeof msg.id === "number") {
    reply(ws, msg.id, { sessionId: "mock-session-1" });
    return;
  }
  if (msg.method === "session.prompt" && typeof msg.id === "number") {
    const sessionId = String(msg.params?.sessionId ?? "mock-session-1");
    reply(ws, msg.id, { ok: true });
    // Stream a simulated agent turn.
    notify(ws, "message.delta", { sessionId, text: "Planning the analysis. " });
    notify(ws, "tool.start", { sessionId, toolCallId: "t1", title: "literature-search (OpenAlex)" });
    notify(ws, "tool.complete", { sessionId, toolCallId: "t1", status: "success", meta: "128 rows" });
    notify(ws, "message.delta", { sessionId, text: "Wrote data/corpus.csv." });
    notify(ws, "session.done", { sessionId });
    return;
  }
  if (msg.method === "approval.respond" && typeof msg.id === "number") {
    reply(ws, msg.id, { ok: true });
  }
}
