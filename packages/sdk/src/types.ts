import type { RuntimeStatus, ToolCallStatus } from "@ai4s/shared";

export type { RuntimeStatus, ToolCallStatus };

/** Pinned OpenCode release this client targets. */
export const OPENCODE_VERSION = "1.17.13";

/** OpenCode server defaults (`opencode serve`). */
export const DEFAULT_OPENCODE_URL = "http://127.0.0.1:4096";

// ---- Normalized events (OpenCode SSE → app) ----
// OpenCode emits idempotent "updated" events (full current value), not deltas, so
// text/tool events carry a stable id and the app upserts by that id.

export interface TextUpdatedEvent {
  type: "text.updated";
  sessionId: string;
  partId: string;
  text: string;
}
export interface ToolUpdatedEvent {
  type: "tool.updated";
  sessionId: string;
  callId: string;
  tool: string;
  status: ToolCallStatus;
  title?: string;
  /** Tool arguments (e.g. a write tool's `filePath` + `content`). */
  input?: Record<string, unknown>;
  /** Tool result text, when the tool returned one. */
  output?: string;
}
export interface SessionIdleEvent {
  type: "session.idle";
  sessionId: string;
}
export interface RuntimeErrorEvent {
  type: "error";
  sessionId?: string;
  message: string;
}

export type OpenCodeEvent =
  | TextUpdatedEvent
  | ToolUpdatedEvent
  | SessionIdleEvent
  | RuntimeErrorEvent;

// ---- REST shapes the app consumes ----

export interface SessionMeta {
  id: string;
  title: string;
  slug?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  location?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  mode?: string;
}

/** A message loaded from history (GET /session/:id/message). */
export interface HistoryMessage {
  role: "user" | "assistant";
  parts: HistoryPart[];
}
export interface HistoryPart {
  type: string;
  text?: string;
  tool?: string;
  state?: {
    status?: string;
    title?: string;
    input?: Record<string, unknown>;
    output?: string;
  };
}

export interface OpenCodeClientOptions {
  /** Base URL of a running `opencode serve`, e.g. http://127.0.0.1:4096 */
  baseUrl?: string;
  /** Optional OPENCODE_SERVER_PASSWORD (basic auth). */
  password?: string;
  username?: string;
  /** Inject fetch (defaults to global fetch; browser + node both have it). */
  fetchImpl?: typeof fetch;
}

// ---- Raw OpenCode wire shapes (subset we consume) ----

export interface OpenCodeRawEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface OpenCodeTextPart {
  id: string;
  type: "text";
  text: string;
}
export interface OpenCodeToolPart {
  id: string;
  type: "tool";
  callID: string;
  tool: string;
  state: { status: "pending" | "running" | "completed" | "error"; title?: string };
}
export type OpenCodePart = OpenCodeTextPart | OpenCodeToolPart | { type: string };
