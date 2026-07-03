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
  /**
   * Workspace directory the server should scope skill discovery to. OpenCode
   * initializes per-directory instances lazily; without this, /api/skill can
   * return an empty list until something else touches the workspace instance.
   */
  directory?: string;
}

// ---- Provider / model configuration (OpenCode-native, one source of truth) ----

export interface ProviderModelInfo {
  id: string;
  name: string;
}

/** A provider OpenCode can use right now (auth present or public). */
export interface ProviderInfo {
  id: string;
  name: string;
  models: ProviderModelInfo[];
}

/** Extra input an auth method needs before starting (e.g. Copilot deployment). */
export interface AuthPrompt {
  type: "select" | "text";
  key: string;
  message: string;
  options?: Array<{ label: string; value: string; hint?: string }>;
}

export interface ProviderAuthMethod {
  type: "oauth" | "api";
  label: string;
  prompts?: AuthPrompt[];
}

/** Catalog entry: a provider OpenCode knows how to talk to (not necessarily connected). */
export interface ProviderCatalogEntry {
  id: string;
  name: string;
  /** Env var(s) that would carry the API key, e.g. ["ANTHROPIC_API_KEY"]. */
  env: string[];
}

export interface OAuthAuthorization {
  url: string;
  /** "auto" — callback completes on its own; "code" — the user pastes a code. */
  method: "auto" | "code";
  instructions: string;
}

// ---- MCP servers ----

export type McpConfig =
  | { type: "local"; command: string[]; enabled?: boolean; environment?: Record<string, string> }
  | { type: "remote"; url: string; enabled?: boolean; headers?: Record<string, string> };

export interface McpServer {
  name: string;
  /** e.g. "connected" | "failed" | "disabled" | "pending" */
  status: string;
  config?: McpConfig;
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
