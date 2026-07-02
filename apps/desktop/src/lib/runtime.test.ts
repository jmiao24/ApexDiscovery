import { describe, expect, it } from "vitest";
import type { OpenCodeEvent } from "@ai4s/sdk";
import { foldEvent, type FoldState } from "./runtime";

const empty: FoldState = { blocks: [], index: {} };

function foldAll(events: OpenCodeEvent[]): FoldState {
  return events.reduce(foldEvent, empty);
}

describe("foldEvent", () => {
  it("upserts a text part by id (idempotent full-text updates, not appends)", () => {
    const s = foldAll([
      { type: "text.updated", partId: "p1", text: "Planning" },
      { type: "text.updated", partId: "p1", text: "Planning the review" },
    ]);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toEqual({ kind: "agent", markdown: "Planning the review" });
  });

  it("upserts a tool call by callId and reflects status transitions", () => {
    const s = foldAll([
      { type: "tool.updated", callId: "c1", tool: "search", status: "running", title: "search" },
      { type: "tool.updated", callId: "c1", tool: "search", status: "success", title: "search (done)" },
    ]);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toMatchObject({ kind: "tool-call", status: "success", title: "search (done)" });
  });

  it("keeps distinct parts as separate blocks in arrival order", () => {
    const s = foldAll([
      { type: "text.updated", partId: "p1", text: "planning" },
      { type: "tool.updated", callId: "c1", tool: "search", status: "success" },
      { type: "text.updated", partId: "p2", text: "done" },
      { type: "session.idle" },
    ]);
    expect(s.blocks.map((b) => b.kind)).toEqual(["agent", "tool-call", "agent", "status-line"]);
  });
});
