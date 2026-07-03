import type {
  AgentInfo,
  HistoryMessage,
  OpenCodeClientOptions,
  OpenCodeEvent,
  OpenCodePart,
  OpenCodeRawEvent,
  RuntimeStatus,
  SessionMeta,
  SkillInfo,
  ToolCallStatus,
} from "./types";
import { DEFAULT_OPENCODE_URL } from "./types";

type EventListener = (event: OpenCodeEvent) => void;
type StatusListener = (status: RuntimeStatus) => void;

function mapToolStatus(status: string): ToolCallStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "error":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * The single boundary between the app and the OpenCode agent runtime.
 * Talks to a running `opencode serve` over its HTTP + SSE API. The UI must go
 * through this class, never the transport directly (see AGENTS.md guardrails).
 */
export class OpenCodeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authHeader: string | null;
  private status: RuntimeStatus = "offline";
  private abort: AbortController | null = null;
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  /** messageID → role, learned from message.updated, to skip echoed user parts. */
  private readonly roles = new Map<string, string>();

  constructor(opts: OpenCodeClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_OPENCODE_URL).replace(/\/$/, "");
    // Bind to globalThis — an unbound `fetch` reference throws "Illegal invocation" in browsers.
    this.fetchImpl = (opts.fetchImpl ?? globalThis.fetch).bind(globalThis);
    this.authHeader = opts.password
      ? "Basic " + btoa(`${opts.username ?? "opencode"}:${opts.password}`)
      : null;
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }
  onEvent(l: EventListener): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }
  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    if (this.authHeader) h["Authorization"] = this.authHeader;
    return h;
  }

  /** Open the SSE event stream. Resolves once the server acknowledges (server.connected). */
  connect(): Promise<void> {
    this.setStatus("connecting");
    this.abort = new AbortController();
    return new Promise((resolve, reject) => {
      let opened = false;
      this.fetchImpl(`${this.baseUrl}/event`, {
        headers: { Accept: "text/event-stream", ...this.headers() },
        signal: this.abort!.signal,
      })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            this.setStatus("error");
            reject(new Error(`OpenCode /event returned ${res.status}`));
            return;
          }
          this.setStatus("ready");
          opened = true;
          resolve();
          await this.readStream(res.body);
        })
        .catch((err) => {
          if (!opened) {
            this.setStatus("error");
            reject(err instanceof Error ? err : new Error(String(err)));
          } else {
            this.setStatus("offline");
          }
        });
    });
  }

  close(): void {
    this.abort?.abort();
    this.abort = null;
    this.setStatus("offline");
  }

  /** Create a new agent session, returning its id. */
  async createSession(): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/session`, {
      method: "POST",
      headers: this.headers(true),
      body: "{}",
    });
    if (!res.ok) throw new Error(`Failed to create session (${res.status})`);
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  /** List existing sessions (conversation history), newest first. */
  async listSessions(): Promise<SessionMeta[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/session`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to list sessions (${res.status})`);
    const arr = (await res.json()) as Array<{ id: string; title?: string; slug?: string }>;
    return arr.map((s) => ({ id: s.id, title: s.title ?? "Untitled", slug: s.slug }));
  }

  /** Delete a session. */
  async deleteSession(sessionId: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to delete session (${res.status})`);
  }

  /** Load a session's message history. */
  async getMessages(sessionId: string): Promise<HistoryMessage[]> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/session/${encodeURIComponent(sessionId)}/message`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
    const arr = (await res.json()) as Array<{
      info: { role: "user" | "assistant" };
      parts: HistoryMessage["parts"];
    }>;
    return arr.map((m) => ({ role: m.info.role, parts: m.parts ?? [] }));
  }

  /** Real skills loaded by OpenCode (built-in + project + user). */
  async listSkills(): Promise<SkillInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/skill`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to list skills (${res.status})`);
    const body = (await res.json()) as { data?: SkillInfo[] };
    return body.data ?? [];
  }

  /** Real agents configured in OpenCode. */
  async listAgents(): Promise<AgentInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/agent`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to list agents (${res.status})`);
    return (await res.json()) as AgentInfo[];
  }

  /** Send a prompt into a session; output streams back via onEvent (SSE). */
  async sendPrompt(sessionId: string, text: string): Promise<void> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async`,
      {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ parts: [{ type: "text", text }] }),
      },
    );
    if (!res.ok) throw new Error(`Failed to send prompt (${res.status})`);
  }

  // ---- internals ----

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          this.handleSseChunk(chunk);
        }
      }
    } catch {
      // aborted or connection dropped
    } finally {
      this.setStatus("offline");
    }
  }

  private handleSseChunk(chunk: string): void {
    const dataLines = chunk
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    if (dataLines.length === 0) return;
    let raw: OpenCodeRawEvent;
    try {
      raw = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    this.normalize(raw);
  }

  private normalize(raw: OpenCodeRawEvent): void {
    const props = raw.properties ?? {};
    switch (raw.type) {
      case "message.updated": {
        // Learn each message's role so we can skip the echoed user message parts.
        const info = props.info as { id?: string; role?: string } | undefined;
        if (info?.id && info.role) this.roles.set(info.id, info.role);
        break;
      }
      case "message.part.updated": {
        const part = props.part as
          | (OpenCodePart & { sessionID?: string; messageID?: string })
          | undefined;
        if (!part) return;
        // The user's own message is echoed here; the app already shows it locally.
        if (part.messageID && this.roles.get(String(part.messageID)) === "user") return;
        const sessionId = String(part.sessionID ?? "");
        if (part.type === "text") {
          const t = part as { id: string; text: string };
          this.emit({ type: "text.updated", sessionId, partId: t.id, text: t.text ?? "" });
        } else if (part.type === "tool") {
          const tp = part as {
            callID: string;
            tool: string;
            state?: { status?: string; title?: string };
          };
          this.emit({
            type: "tool.updated",
            sessionId,
            callId: tp.callID,
            tool: tp.tool,
            status: mapToolStatus(tp.state?.status ?? "pending"),
            title: tp.state?.title,
          });
        }
        break;
      }
      case "session.idle":
        this.emit({ type: "session.idle", sessionId: String(props.sessionID ?? "") });
        break;
      case "session.error": {
        const err = props.error as
          | { name?: string; message?: string; data?: { message?: string } }
          | undefined;
        // OpenCode nests the human-readable message at error.data.message.
        const full = err?.data?.message ?? err?.message ?? err?.name ?? "session error";
        // Keep the first line — OpenCode appends a stack trace to some errors.
        this.emit({
          type: "error",
          sessionId: String(props.sessionID ?? ""),
          message: full.split("\n")[0],
        });
        break;
      }
      default:
        break; // server.connected and others are ignored
    }
  }

  private emit(event: OpenCodeEvent): void {
    this.eventListeners.forEach((l) => l(event));
  }
  private setStatus(status: RuntimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
}
