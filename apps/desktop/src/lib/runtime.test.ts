import { describe, expect, it } from "vitest";
import type { GatewayEvent } from "@ai4s/sdk";
import { foldGatewayEvent, type FoldState } from "./runtime";

const empty: FoldState = { blocks: [], activeAgentIndex: null };

function foldAll(events: GatewayEvent[]): FoldState {
  return events.reduce(foldGatewayEvent, empty);
}

describe("foldGatewayEvent", () => {
  it("accumulates consecutive message.delta into one agent block", () => {
    const s = foldAll([
      { type: "message.delta", sessionId: "s", text: "Hello " },
      { type: "message.delta", sessionId: "s", text: "world" },
    ]);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toEqual({ kind: "agent", markdown: "Hello world" });
  });

  it("renders a tool call and marks it complete", () => {
    const s = foldAll([
      { type: "tool.start", sessionId: "s", toolCallId: "t1", title: "search" },
      { type: "tool.complete", sessionId: "s", toolCallId: "t1", status: "success", meta: "12 rows" },
    ]);
    expect(s.blocks[0]).toMatchObject({ kind: "tool-call", status: "success", meta: "12 rows" });
  });

  it("starts a fresh agent block after a tool call", () => {
    const s = foldAll([
      { type: "message.delta", sessionId: "s", text: "planning" },
      { type: "tool.start", sessionId: "s", toolCallId: "t1", title: "search" },
      { type: "tool.complete", sessionId: "s", toolCallId: "t1", status: "success" },
      { type: "message.delta", sessionId: "s", text: "done analysis" },
      { type: "session.done", sessionId: "s" },
    ]);
    const kinds = s.blocks.map((b) => b.kind);
    expect(kinds).toEqual(["agent", "tool-call", "agent", "status-line"]);
    expect(s.blocks[2]).toEqual({ kind: "agent", markdown: "done analysis" });
  });
});
