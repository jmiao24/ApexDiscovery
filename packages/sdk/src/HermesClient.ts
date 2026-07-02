import type {
  ApprovalDecision,
  GatewayEvent,
  HermesClientOptions,
  RuntimeStatus,
  SocketFactory,
  SocketLike,
} from "./types";

/** Pinned Gateway protocol version. Bump deliberately when the contract changes. */
export const HERMES_PROTOCOL_VERSION = "0.1";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type EventListener = (event: GatewayEvent) => void;
type StatusListener = (status: RuntimeStatus) => void;

const NOTIFICATION_METHODS = new Set([
  "message.delta",
  "tool.start",
  "tool.progress",
  "tool.complete",
  "approval.request",
  "session.done",
  "error",
]);

function defaultSocketFactory(url: string): SocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
  if (!Ctor) throw new Error("No WebSocket implementation; pass socketFactory.");
  return new Ctor(url);
}

/**
 * The single boundary between the app and the Hermes agent runtime.
 * Speaks JSON-RPC 2.0 over a WebSocket to the Hermes TUI Gateway. The UI must
 * go through this class, never the transport directly (see AGENTS.md guardrails).
 */
export class HermesClient {
  private readonly url: string;
  private readonly makeSocket: SocketFactory;
  private socket: SocketLike | null = null;
  private status: RuntimeStatus = "offline";
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(opts: HermesClientOptions) {
    this.url = opts.url;
    this.makeSocket = opts.socketFactory ?? defaultSocketFactory;
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Open the connection. Resolves when the socket is open (status "ready"). */
  connect(): Promise<void> {
    this.setStatus("connecting");
    return new Promise((resolve, reject) => {
      let socket: SocketLike;
      try {
        socket = this.makeSocket(this.url);
      } catch (err) {
        this.setStatus("error");
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.socket = socket;
      socket.onopen = () => {
        this.setStatus("ready");
        resolve();
      };
      socket.onmessage = (ev) => this.handleMessage(String(ev.data));
      socket.onerror = () => {
        this.setStatus("error");
        reject(new Error("Hermes Gateway connection error"));
      };
      socket.onclose = () => {
        this.failAllPending(new Error("connection closed"));
        this.setStatus("offline");
      };
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.setStatus("offline");
  }

  /** Create a new agent session, returning its id. */
  async createSession(): Promise<string> {
    const result = (await this.request("session.create", {})) as { sessionId: string };
    return result.sessionId;
  }

  /** Send a prompt into a session. Streamed output arrives via onEvent. */
  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    await this.request("session.prompt", { sessionId, prompt });
  }

  /** Respond to an approval.request surfaced by the agent. */
  async respondApproval(requestId: string, decision: ApprovalDecision): Promise<void> {
    await this.request("approval.respond", { requestId, decision });
  }

  // ---- internals ----

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.socket || this.status !== "ready") {
      return Promise.reject(new Error(`Not connected to Hermes Gateway (status: ${this.status})`));
    }
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.send(JSON.stringify(payload));
    });
  }

  private handleMessage(raw: string): void {
    let msg: JsonRpcResponse | JsonRpcNotification;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Response to a pending request.
    if ("id" in msg && typeof msg.id === "number") {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
      return;
    }

    // Notification → typed event.
    if ("method" in msg && NOTIFICATION_METHODS.has(msg.method)) {
      const event = { type: msg.method, ...(msg.params ?? {}) } as GatewayEvent;
      this.eventListeners.forEach((l) => l(event));
    }
  }

  private setStatus(status: RuntimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  private failAllPending(err: Error): void {
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }
}
