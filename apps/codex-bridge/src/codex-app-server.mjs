import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveCodexExecutable } from "./codex-sandbox.mjs";

class AsyncQueue {
  constructor() {
    this.values = [];
    this.waiters = [];
    this.closed = false;
  }

  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  next() {
    if (this.values.length) return Promise.resolve({ value: this.values.shift(), done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

function mapChangeKind(kind) {
  if (kind?.type === "add" || kind?.type === "delete") return kind.type;
  return "update";
}

function mapItem(item) {
  if (!item || typeof item !== "object") return null;
  switch (item.type) {
    case "agentMessage":
      return { type: "agent_message", id: item.id, text: item.text ?? "" };
    case "commandExecution":
      return {
        type: "command_execution",
        id: item.id,
        command: item.command ?? "",
        cwd: item.cwd,
        status: item.status === "inProgress" ? "in_progress" : item.status,
        aggregated_output: item.aggregatedOutput ?? "",
        exit_code: item.exitCode,
      };
    case "fileChange":
      return {
        type: "file_change",
        id: item.id,
        status: item.status === "inProgress" ? "in_progress" : item.status,
        changes: (item.changes ?? []).map((change) => ({
          path: change.path,
          kind: mapChangeKind(change.kind),
        })),
      };
    case "mcpToolCall":
      return {
        type: "mcp_tool_call",
        id: item.id,
        server: item.server,
        tool: item.tool,
        status: item.status === "inProgress" ? "in_progress" : item.status,
        arguments: item.arguments,
        result: item.result
          ? {
              content: item.result.content ?? [],
              structured_content: item.result.structuredContent ?? undefined,
              _meta: item.result._meta ?? undefined,
            }
          : null,
        error: item.error,
      };
    case "webSearch":
      return { type: "web_search", id: item.id, query: item.query ?? "" };
    default:
      return null;
  }
}

function requestError(message) {
  const detail = message?.error?.message ?? "Codex app-server request failed";
  const error = new Error(detail);
  error.data = message?.error?.data;
  return error;
}

/** Translate the APEX approval choice into the app-server protocol decision. */
export function appServerApprovalDecision(reply, {
  method,
  proposedExecpolicyAmendment,
} = {}) {
  if (reply === "reject") return "decline";
  if (reply !== "always") return "accept";
  if (method === "item/commandExecution/requestApproval" && proposedExecpolicyAmendment) {
    return {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: proposedExecpolicyAmendment,
      },
    };
  }
  return "acceptForSession";
}

/**
 * One long-lived Codex app-server process. Unlike `codex exec`, this transport
 * remains bidirectional while a turn runs, so APEX can steer, interrupt, and
 * answer approval requests without weakening the Codex sandbox.
 */
export class CodexAppServer {
  constructor({ executable, env, onServerRequest, onStderr, spawnProcess = spawn } = {}) {
    this.executable = executable || resolveCodexExecutable();
    this.env = env;
    this.onServerRequest = onServerRequest;
    this.onStderr = onStderr;
    this.spawnProcess = spawnProcess;
    this.child = null;
    this.ready = null;
    this.nextId = 1;
    this.pending = new Map();
    this.subscribers = new Set();
    this.threadSessions = new Map();
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = this.#start();
    try {
      await this.ready;
    } catch (error) {
      this.ready = null;
      throw error;
    }
  }

  async #start() {
    const child = this.spawnProcess(this.executable, ["app-server", "--listen", "stdio://"], {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.#receive(line));
    createInterface({ input: child.stderr }).on("line", (line) => this.onStderr?.(line));
    child.once("error", (error) => this.#fail(error));
    child.once("exit", (code, signal) => {
      this.#fail(new Error(`Codex app-server exited (${signal ?? code ?? "unknown"})`));
    });
    await this.request("initialize", {
      clientInfo: { name: "apex_discovery", title: "APEX Discovery", version: "0.1.9" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    }, { skipStart: true });
    this.notify("initialized");
  }

  #write(message) {
    if (!this.child?.stdin?.writable) throw new Error("Codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  async request(method, params, { skipStart = false } = {}) {
    if (!skipStart) await this.start();
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.#write({ id, method, ...(params === undefined ? {} : { params }) });
    return response;
  }

  notify(method, params) {
    this.#write({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id, result) {
    this.#write({ id, result });
  }

  respondError(id, code, message) {
    this.#write({ id, error: { code, message } });
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  registerThread(threadId, sessionId) {
    if (threadId && sessionId) this.threadSessions.set(threadId, sessionId);
  }

  sessionForThread(threadId) {
    return this.threadSessions.get(threadId) ?? null;
  }

  #receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.onStderr?.(`Invalid app-server JSON: ${line}`);
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(requestError(message));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      Promise.resolve(this.onServerRequest?.(message, this))
        .catch((error) => this.respondError(message.id, -32000, error instanceof Error ? error.message : String(error)));
      return;
    }
    if (message.method) {
      for (const listener of this.subscribers) listener(message);
    }
  }

  #fail(error) {
    if (!this.child && !this.ready) return;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    for (const listener of this.subscribers) listener({
      method: "apex/appServerError",
      params: { error },
    });
    this.child = null;
    this.ready = null;
  }

  close() {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child && !child.killed) child.kill("SIGTERM");
  }
}

function threadParams(options, config) {
  return {
    cwd: options.workingDirectory,
    ...(options.model ? { model: options.model } : {}),
    approvalPolicy: options.approvalPolicy ?? "on-request",
    approvalsReviewer: "user",
    sandbox: options.sandboxMode ?? "workspace-write",
    runtimeWorkspaceRoots: [
      options.workingDirectory,
      ...(options.additionalDirectories ?? []),
    ].filter(Boolean),
    config: {
      ...config,
      ...(options.webSearchMode ? { web_search: options.webSearchMode } : {}),
    },
  };
}

class CodexAppServerThread {
  constructor(server, { threadId, options, config, sessionId }) {
    this.server = server;
    this.threadId = threadId;
    this.options = options;
    this.config = config;
    this.sessionId = sessionId;
    this.activeTurnId = null;
    this.activeWaiters = [];
  }

  async #ensureThread() {
    if (this.threadId) {
      const result = await this.server.request("thread/resume", {
        threadId: this.threadId,
        ...threadParams(this.options, this.config),
        excludeTurns: true,
      });
      this.threadId = result.thread.id;
    } else {
      const result = await this.server.request("thread/start", {
        ...threadParams(this.options, this.config),
        historyMode: "legacy",
      });
      this.threadId = result.thread.id;
    }
    this.server.registerThread(this.threadId, this.sessionId);
    return this.threadId;
  }

  async runStreamed(prompt) {
    const threadId = await this.#ensureThread();
    const queue = new AsyncQueue();
    queue.push({ type: "thread.started", thread_id: threadId });
    const items = new Map();
    let turnId = null;
    const unsubscribe = this.server.subscribe((message) => {
      const params = message.params ?? {};
      if (params.threadId && params.threadId !== threadId) return;
      if (turnId && params.turnId && params.turnId !== turnId) return;
      switch (message.method) {
        case "turn/started":
          turnId = params.turn?.id ?? turnId;
          this.activeTurnId = turnId;
          for (const waiter of this.activeWaiters.splice(0)) waiter.resolve(turnId);
          queue.push({ type: "turn.started" });
          break;
        case "item/started": {
          const mapped = mapItem(params.item);
          if (!mapped) break;
          items.set(mapped.id, mapped);
          queue.push({ type: "item.started", item: mapped });
          break;
        }
        case "item/agentMessage/delta": {
          const item = items.get(params.itemId) ?? { type: "agent_message", id: params.itemId, text: "" };
          item.text = `${item.text ?? ""}${params.delta ?? ""}`;
          items.set(item.id, item);
          queue.push({ type: "item.updated", item: { ...item } });
          break;
        }
        case "item/commandExecution/outputDelta": {
          const item = items.get(params.itemId);
          if (!item) break;
          item.aggregated_output = `${item.aggregated_output ?? ""}${params.delta ?? ""}`;
          queue.push({ type: "item.updated", item: { ...item } });
          break;
        }
        case "item/completed": {
          const mapped = mapItem(params.item);
          if (!mapped) break;
          items.set(mapped.id, mapped);
          queue.push({ type: "item.completed", item: mapped });
          break;
        }
        case "error":
          if (!params.willRetry) queue.push({ type: "error", message: params.error?.message ?? "Codex turn failed" });
          break;
        case "turn/completed": {
          const status = params.turn?.status;
          if (status === "failed") {
            queue.push({ type: "turn.failed", error: params.turn?.error ?? { message: "Codex turn failed" } });
          }
          this.activeTurnId = null;
          queue.push({ type: "turn.completed" });
          queue.close();
          unsubscribe();
          break;
        }
        case "apex/appServerError":
          queue.push({ type: "error", message: params.error?.message ?? "Codex app-server stopped" });
          queue.close();
          unsubscribe();
          break;
        default:
          break;
      }
    });

    try {
      const result = await this.server.request("turn/start", {
        threadId,
        input: [{ type: "text", text: String(prompt), text_elements: [] }],
      });
      turnId = result.turn.id;
      this.activeTurnId = turnId;
      for (const waiter of this.activeWaiters.splice(0)) waiter.resolve(turnId);
    } catch (error) {
      for (const waiter of this.activeWaiters.splice(0)) waiter.reject(error);
      unsubscribe();
      queue.close();
      throw error;
    }

    return {
      events: queue,
      threadId,
      turnId,
    };
  }

  async steer(text) {
    if (!this.activeTurnId) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Codex turn did not become steerable")), 10_000);
        this.activeWaiters.push({
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
      });
    }
    if (!this.threadId || !this.activeTurnId) throw new Error("No active Codex turn to steer");
    await this.server.request("turn/steer", {
      threadId: this.threadId,
      expectedTurnId: this.activeTurnId,
      input: [{ type: "text", text: String(text), text_elements: [] }],
    });
  }

  async interrupt() {
    if (!this.threadId || !this.activeTurnId) return false;
    await this.server.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    });
    return true;
  }
}

/** Small compatibility facade for the old SDK surface used by the bridge. */
export class AppServerCodex {
  constructor(server, { config = {}, sessionId } = {}) {
    this.server = server;
    this.config = config;
    this.sessionId = sessionId;
  }

  startThread(options = {}) {
    return new CodexAppServerThread(this.server, {
      threadId: null,
      options,
      config: this.config,
      sessionId: this.sessionId,
    });
  }

  resumeThread(threadId, options = {}) {
    return new CodexAppServerThread(this.server, {
      threadId,
      options,
      config: this.config,
      sessionId: this.sessionId,
    });
  }
}
