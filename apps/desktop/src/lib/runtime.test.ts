import { describe, expect, it } from "vitest";
import type { OpenCodeEvent, HistoryMessage } from "@ai4s/sdk";
import { foldEvent, historyToThread, type FoldState } from "./runtime";

const empty: FoldState = { blocks: [], index: {} };
const S = "ses_1";
const foldAll = (events: OpenCodeEvent[]): FoldState => events.reduce(foldEvent, empty);

describe("foldEvent", () => {
  it("upserts a text part by id (idempotent full-text updates, not appends)", () => {
    const s = foldAll([
      { type: "text.updated", sessionId: S, partId: "p1", text: "Planning" },
      { type: "text.updated", sessionId: S, partId: "p1", text: "Planning the review" },
    ]);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toEqual({ kind: "agent", markdown: "Planning the review" });
  });

  it("upserts a tool call by callId and reflects status transitions", () => {
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "search", status: "running", title: "search" },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "search", status: "success", title: "search (done)" },
    ]);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toMatchObject({ kind: "tool-call", status: "success", title: "search (done)" });
  });

  it("never blanks a tool row when the completed event reports an empty title", () => {
    // Completed MCP tool parts carry title: "" — the tool name must survive.
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "jupyter_insert_cell", status: "running" },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "jupyter_insert_cell", status: "success", title: "" },
    ]);
    expect(s.blocks[0]).toMatchObject({
      kind: "tool-call",
      status: "success",
      title: "jupyter_insert_cell",
    });
  });

  it("surfaces a written file as an artifact block, deduped by path", () => {
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "write", status: "running", input: { filePath: "fig.py" } },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "write", status: "success", input: { filePath: "fig.py", content: "print(1)" } },
    ]);
    const artifacts = s.blocks.filter((b) => b.kind === "artifact");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "artifact", filename: "fig.py", artifact: "script", content: "print(1)" });
    // The tool-call row is still present alongside the artifact.
    expect(s.blocks.some((b) => b.kind === "tool-call")).toBe(true);
  });

  it("keeps distinct parts as separate blocks in arrival order", () => {
    const s = foldAll([
      { type: "text.updated", sessionId: S, partId: "p1", text: "planning" },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "search", status: "success" },
      { type: "text.updated", sessionId: S, partId: "p2", text: "done" },
      { type: "session.idle", sessionId: S },
    ]);
    expect(s.blocks.map((b) => b.kind)).toEqual(["agent", "tool-call", "agent", "status-line"]);
  });
});

describe("historyToThread", () => {
  it("converts user/assistant messages (text + tool parts) into blocks", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "planning" },
          { type: "tool", tool: "search", state: { status: "completed", title: "search" } },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks.map((b) => b.kind)).toEqual(["user", "agent", "tool-call"]);
    expect(t.blocks[2]).toMatchObject({ kind: "tool-call", status: "success" });
  });
});
