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

  const messages: Record<string, Array<{ info: unknown; parts: unknown[] }>> = {};

  const streamTurn = (sessionID: string) => {
    const push = (obj: unknown) => clients.forEach((c) => send(c, obj));
    const P = (part: Record<string, unknown>) =>
      push({ type: "message.part.updated", properties: { part: { sessionID, ...part } } });
    P({ id: "p1", type: "text", text: "Planning the analysis. " });
    P({ id: "c1", type: "tool", callID: "c1", tool: "literature-search", state: { status: "running", title: "literature-search (OpenAlex)" } });
    P({ id: "c1", type: "tool", callID: "c1", tool: "literature-search", state: { status: "completed", title: "literature-search (OpenAlex, PubMed)" } });
    P({ id: "p2", type: "text", text: "Wrote data/corpus.csv and drafted report.md." });
    push({ type: "session.idle", properties: { sessionID } });
    messages[sessionID] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "run a literature review" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Planning the analysis. Wrote data/corpus.csv." }] },
    ];
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
      res.end(JSON.stringify({ id: "ses_mock", title: "New session", slug: "mock" }));
      return;
    }
    if (req.method === "GET" && /^\/session\/?$/.test(url)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: "ses_mock", title: "New session", slug: "mock" }]));
      return;
    }
    const mm = url.match(/^\/session\/([^/]+)\/message/);
    if (req.method === "GET" && mm) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(messages[decodeURIComponent(mm[1])] ?? []));
      return;
    }
    if (req.method === "GET" && url.startsWith("/api/skill")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ name: "customize-opencode", description: "Configure OpenCode.", location: "/builtin/customize-opencode.md" }] }));
      return;
    }
    if (req.method === "GET" && (url === "/agent" || url === "/api/agent")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ name: "build", description: "Default agent.", mode: "primary" }]));
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
