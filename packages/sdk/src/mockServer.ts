// A minimal OpenCode-protocol server for tests and local dev. Node-only.
// Implements the endpoints the app uses (POST /session, POST /session/:id/prompt_async,
// GET /event SSE) and streams an OpenCode-shaped agent turn.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface MockOpenCode {
  port: number;
  close: () => Promise<void>;
}

export function startMockOpenCode(port = 0): Promise<MockOpenCode> {
  const clients = new Set<ServerResponse>();

  const send = (res: ServerResponse, obj: unknown) =>
    res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const streamTurn = (sessionID: string) => {
    const push = (obj: unknown) => clients.forEach((c) => send(c, obj));
    push({ type: "message.part.updated", properties: { part: { id: "p1", type: "text", text: "Planning the analysis. " } } });
    push({ type: "message.part.updated", properties: { part: { id: "c1", type: "tool", callID: "c1", tool: "literature-search", state: { status: "running", title: "literature-search (OpenAlex)" } } } });
    push({ type: "message.part.updated", properties: { part: { id: "c1", type: "tool", callID: "c1", tool: "literature-search", state: { status: "completed", title: "literature-search (OpenAlex, PubMed)" } } } });
    push({ type: "message.part.updated", properties: { part: { id: "p2", type: "text", text: "Wrote data/corpus.csv and drafted report.md." } } });
    push({ type: "session.idle", properties: { sessionID } });
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.startsWith("/event")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      send(res, { type: "server.connected", properties: {} });
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "POST" && /^\/session\/?$/.test(url)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "ses_mock" }));
      return;
    }
    const m = url.match(/^\/session\/([^/]+)\/prompt_async/);
    if (req.method === "POST" && m) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      setTimeout(() => streamTurn(decodeURIComponent(m[1])), 5);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () =>
          new Promise((r) => {
            for (const c of clients) c.end();
            clients.clear();
            server.close(() => r());
          }),
      });
    });
  });
}
