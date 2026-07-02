import type { RuntimeStatus, ToolCallStatus } from "@ai4s/shared";

export type { RuntimeStatus, ToolCallStatus };

/** Approval decisions surfaced by the desktop approval dialog. */
export type ApprovalDecision = "allow-once" | "allow-project" | "deny";

// ---- Streaming events (Hermes TUI Gateway → client) ----
// Modelled on the documented Gateway event contract (see docs/TECHNICAL_DESIGN.md §5.2).

export interface MessageDeltaEvent {
  type: "message.delta";
  sessionId: string;
  text: string;
}
export interface ToolStartEvent {
  type: "tool.start";
  sessionId: string;
  toolCallId: string;
  title: string;
}
export interface ToolProgressEvent {
  type: "tool.progress";
  sessionId: string;
  toolCallId: string;
  meta: string;
}
export interface ToolCompleteEvent {
  type: "tool.complete";
  sessionId: string;
  toolCallId: string;
  status: ToolCallStatus;
  meta?: string;
}
export interface ApprovalRequestEvent {
  type: "approval.request";
  sessionId: string;
  requestId: string;
  action: string;
}
export interface SessionDoneEvent {
  type: "session.done";
  sessionId: string;
}
export interface GatewayErrorEvent {
  type: "error";
  message: string;
}

export type GatewayEvent =
  | MessageDeltaEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolCompleteEvent
  | ApprovalRequestEvent
  | SessionDoneEvent
  | GatewayErrorEvent;

/** Minimal WebSocket surface shared by the browser `WebSocket` and node `ws`. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface HermesClientOptions {
  url: string;
  /** Inject a socket (node `ws` in tests); defaults to the global WebSocket. */
  socketFactory?: SocketFactory;
  /** Pinned Gateway protocol version this client targets. */
  protocolVersion?: string;
}
