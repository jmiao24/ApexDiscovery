import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { AppServerCodex, CodexAppServer } from "./codex-app-server.mjs";

function fakeAppServer() {
  const received = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let turnNumber = 0;
  const send = (message) => stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit("exit", 0, null));
  };
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).trim().split("\n")) {
        const message = JSON.parse(line);
        received.push(message);
        if (message.method === "initialize") send({ id: message.id, result: { userAgent: "fake" } });
        if (message.method === "thread/start") {
          send({ id: message.id, result: { thread: { id: "thr_apex" } } });
        }
        if (message.method === "turn/start") {
          turnNumber += 1;
          const turnId = `turn_${turnNumber}`;
          send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
          queueMicrotask(() => {
            send({ method: "turn/started", params: { threadId: "thr_apex", turn: { id: turnId } } });
            send({
              method: "item/started",
              params: {
                threadId: "thr_apex",
                turnId,
                item: { type: "agentMessage", id: `msg_${turnNumber}`, text: "", phase: null, memoryCitation: null },
              },
            });
            send({
              method: "item/agentMessage/delta",
              params: { threadId: "thr_apex", turnId, itemId: `msg_${turnNumber}`, delta: "Working" },
            });
          });
        }
        if (message.method === "turn/steer") {
          send({ id: message.id, result: {} });
          queueMicrotask(() => {
            send({
              id: 700,
              method: "item/commandExecution/requestApproval",
              params: {
                threadId: "thr_apex",
                turnId: "turn_1",
                itemId: "cmd_1",
                command: "paperclip search -s pmc PCSK9",
              },
            });
          });
        }
        if (message.id === 700 && message.result) {
          queueMicrotask(() => {
            send({
              method: "item/completed",
              params: {
                threadId: "thr_apex",
                turnId: "turn_1",
                item: {
                  type: "agentMessage",
                  id: "msg_1",
                  text: "Working",
                  phase: null,
                  memoryCitation: null,
                },
              },
            });
            send({
              method: "turn/completed",
              params: { threadId: "thr_apex", turn: { id: "turn_1", status: "completed", error: null } },
            });
          });
        }
        if (message.method === "turn/interrupt") {
          send({ id: message.id, result: {} });
          queueMicrotask(() => send({
            method: "turn/completed",
            params: {
              threadId: "thr_apex",
              turn: { id: message.params.turnId, status: "interrupted", error: null },
            },
          }));
        }
      }
      callback();
    },
  });
  return { child, received };
}

test("app-server streams a turn, steers it, and answers native command approval", async () => {
  const fake = fakeAppServer();
  const approvals = [];
  const server = new CodexAppServer({
    executable: "/fake/codex",
    spawnProcess: () => fake.child,
    onServerRequest: (message, transport) => {
      approvals.push(message);
      transport.respond(message.id, { decision: "accept" });
    },
  });
  const codex = new AppServerCodex(server, {
    sessionId: "ses_apex",
    config: { mcp_servers: { apex_execution: { command: "node", args: ["science-mcp.mjs"] } } },
  });
  const thread = codex.startThread({
    workingDirectory: "/workspace",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    webSearchMode: "live",
  });
  const { events } = await thread.runStreamed("Find PCSK9 papers");
  await thread.steer("Prioritize human genetics");
  const streamed = [];
  for await (const event of events) streamed.push(event);

  assert.equal(approvals[0].method, "item/commandExecution/requestApproval");
  assert.equal(server.sessionForThread("thr_apex"), "ses_apex");
  assert(streamed.some((event) => event.type === "thread.started" && event.thread_id === "thr_apex"));
  assert(streamed.some((event) => event.type === "item.updated" && event.item.text === "Working"));
  assert(fake.received.some((message) => message.method === "turn/steer"
    && message.params.input[0].text === "Prioritize human genetics"));
  assert(fake.received.some((message) => message.id === 700 && message.result.decision === "accept"));
  assert(fake.received.some((message) => message.method === "thread/start"
    && message.params.approvalsReviewer === "user"
    && message.params.config.web_search === "live"));
  server.close();
});
test("app-server interruption targets the active Codex turn", async () => {
  const fake = fakeAppServer();
  const server = new CodexAppServer({ executable: "/fake/codex", spawnProcess: () => fake.child });
  const thread = new AppServerCodex(server, { sessionId: "ses_apex" }).startThread({
    workingDirectory: "/workspace",
  });
  const { events } = await thread.runStreamed("Long task");
  assert.equal(await thread.interrupt(), true);
  for await (const _event of events) { /* drain */ }
  assert(fake.received.some((message) => message.method === "turn/interrupt"
    && message.params.turnId === "turn_1"));
  server.close();
});
