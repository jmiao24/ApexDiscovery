import { describe, expect, it } from "vitest";
import type { OpenCodeEvent, HistoryMessage } from "@ai4s/sdk";
import {
  datedWorkspaceName,
  foldCarriageReturns,
  foldEvent,
  historyToThread,
  humanizeCommand,
  subagentActivity,
  tidyToolTitle,
  toolPresentation,
  webResearchResultFromOutput,
  type FoldState,
} from "./runtime";

const empty: FoldState = { blocks: [], index: {} };
const S = "ses_1";
const foldAll = (events: OpenCodeEvent[], from: FoldState = empty): FoldState =>
  events.reduce((s, e) => foldEvent(s, e), from);

describe("tidyToolTitle", () => {
  it("shows workspace files by their relative path", () => {
    expect(tidyToolTitle("/Users/asq/Documents/OpenScience/demo/analyze.py")).toBe("demo/analyze.py");
    expect(tidyToolTitle("mkdir -p /Users/asq/Documents/OpenScience/demo_analysis")).toBe(
      "mkdir -p demo_analysis",
    );
    // OpenCode's write-tool titles drop the leading slash — must still relativize.
    expect(tidyToolTitle("Users/asq/Documents/OpenScience/demo_analysis/analyze.py")).toBe(
      "demo_analysis/analyze.py",
    );
  });
  it("leaves non-workspace titles unchanged", () => {
    expect(tidyToolTitle("search (done)")).toBe("search (done)");
    expect(tidyToolTitle("python3 -c \"import numpy\"")).toBe('python3 -c "import numpy"');
  });
});

describe("humanizeCommand", () => {
  it("strips leading cd hops so the real command leads", () => {
    expect(
      humanizeCommand("cd output/experiment-suite/very/long/path && python train.py --mode teacher"),
    ).toBe("python train.py --mode teacher");
    expect(humanizeCommand("cd /a/b; cd c && ls -la")).toBe("ls -la");
    expect(humanizeCommand('cd "dir with spaces" && make test')).toBe("make test");
  });
  it("collapses whitespace but leaves cd-less commands intact", () => {
    expect(humanizeCommand("git  status\n  --short")).toBe("git status --short");
  });
  it("a bare cd keeps the command (nothing better to show)", () => {
    expect(humanizeCommand("cd demo")).toBe("cd demo");
  });
});

describe("foldCarriageReturns", () => {
  it("keeps only what each line last drew (tqdm-style redraws)", () => {
    expect(foldCarriageReturns("epoch 1:  10%\repoch 1:  50%\repoch 1: 100%\ndone")).toBe(
      "epoch 1: 100%\ndone",
    );
    expect(foldCarriageReturns("plain\ntext")).toBe("plain\ntext");
  });
});

describe("toolPresentation", () => {
  it("does not infer a human description from a bash command", () => {
    expect(toolPresentation("bash", "install deps", { command: "cd x && pip install numpy" })).toEqual({
      verb: "Ran",
      title: "Missing activity description",
      naturalTitle: true,
    });
  });
  it("prefers the model-supplied human_description from the bridge protocol", () => {
    expect(toolPresentation("bash", "python script.py", {
      command: "python script.py",
      human_description: "Building MC4R opportunity table",
    })).toEqual({
      verb: "Ran",
      title: "Building MC4R opportunity table",
      naturalTitle: true,
    });
  });
  it("presents ExecuteCode with its required human description", () => {
    expect(toolPresentation("execute_code", "ExecuteCode", {
      code: "print(1)",
      human_description: "Calculating cohort summary statistics",
    })).toEqual({
      verb: "Ran",
      title: "Calculating cohort summary statistics",
      naturalTitle: true,
    });
  });
  it("presents custom web research with the model-authored action label", () => {
    expect(toolPresentation("websearch", "WebSearch", {
      query: "MC4R FDA evidence",
      human_description: "Checking FDA MC4R evidence",
    })).toEqual({
      verb: "Searched",
      title: "Checking FDA MC4R evidence",
      naturalTitle: true,
    });
  });
  it("file tools: verb + relative path", () => {
    expect(
      toolPresentation("write", "", { filePath: "/Users/asq/Documents/OpenScience/demo/train.py" }),
    ).toEqual({ verb: "Created", title: "demo/train.py" });
    expect(toolPresentation("edit", "", { filePath: "config.yaml" })).toEqual({
      verb: "Edited",
      title: "config.yaml",
    });
  });
  it("unknown tools keep the old fallback chain, no verb", () => {
    expect(toolPresentation("mcp_thing", "did something", {})).toEqual({ title: "did something" });
    expect(toolPresentation("mcp_thing", "", {})).toEqual({ title: "mcp_thing" });
  });
});

describe("webResearchResultFromOutput", () => {
  it("normalizes the bridge research envelope", () => {
    expect(webResearchResultFromOutput(JSON.stringify({
      kind: "search",
      query: "MC4R evidence",
      answer: "Supported summary",
      sources: [{ title: "FDA label", url: "https://fda.gov/label" }],
      result_count: 3,
      duration_ms: 1250,
    }))).toEqual({
      kind: "search",
      query: "MC4R evidence",
      answer: "Supported summary",
      sources: [{ title: "FDA label", url: "https://fda.gov/label" }],
      resultCount: 3,
      durationMs: 1250,
    });
  });

  it("rejects unrelated tool output", () => {
    expect(webResearchResultFromOutput("plain stdout")).toBeUndefined();
  });
});

describe("datedWorkspaceName", () => {
  it("formats a zero-padded YYYY-MM-DD-HHMM folder name", () => {
    expect(datedWorkspaceName(new Date(2026, 6, 4, 16, 5))).toBe("2026-07-04-1605");
    expect(datedWorkspaceName(new Date(2026, 0, 9, 3, 40))).toBe("2026-01-09-0340");
  });
});

describe("foldEvent", () => {
  it("folds an audited skill load with source, path, content, and timing", () => {
    const s = foldAll([
      {
        type: "tool.updated",
        sessionId: S,
        callId: "skill-1",
        tool: "skill",
        status: "success",
        title: "Loaded open-targets skill",
        input: {
          action: "load",
          name: "open-targets",
          source: "user",
          path: "/home/.agents/skills/open-targets/SKILL.md",
        },
        output: "# Open Targets\nUse GraphQL.",
        startedAt: 100,
        endedAt: 161,
      },
    ]);
    expect(s.blocks[0]).toMatchObject({
      kind: "tool-call",
      tool: "skill",
      status: "success",
      title: "Loaded open-targets skill",
      skillName: "open-targets",
      skillSource: "user",
      skillPath: "/home/.agents/skills/open-targets/SKILL.md",
      output: "# Open Targets\nUse GraphQL.",
      startedAt: 100,
      endedAt: 161,
    });
  });

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

  it("does not render interactive question/permission tools as thread rows", () => {
    // These are surfaced by InteractionPrompt (answerable), not as blank rows.
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "q1", tool: "question", status: "running", title: "" },
      { type: "tool.updated", sessionId: S, callId: "p1", tool: "permission", status: "running", title: "" },
    ]);
    expect(s.blocks).toHaveLength(0);
  });

  it("drops opaque todo tool rows from the conversation", () => {
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "t1", tool: "todowrite", status: "success", title: "4 todos" },
    ]);
    expect(s.blocks).toHaveLength(0);
  });

  it("drops empty Codex open-page placeholders instead of inventing a web search", () => {
    const s = foldAll([
      {
        type: "tool.updated",
        sessionId: S,
        callId: "ws-empty",
        tool: "websearch",
        status: "success",
        title: "web search",
        input: { pattern: "" },
      },
    ]);
    expect(s.blocks).toHaveLength(0);
  });

  it("keeps real built-in and rich APEX web searches", () => {
    const s = foldAll([
      {
        type: "tool.updated",
        sessionId: S,
        callId: "ws-query",
        tool: "websearch",
        status: "success",
        title: "MC4R clinical evidence",
        input: { pattern: "MC4R clinical evidence" },
      },
      {
        type: "tool.updated",
        sessionId: S,
        callId: "ws-rich",
        tool: "websearch",
        status: "success",
        title: "Checking MC4R clinical evidence",
        input: {
          query: "MC4R clinical evidence",
          human_description: "Checking MC4R clinical evidence",
        },
      },
    ]);
    expect(s.blocks).toHaveLength(2);
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

  it("shows the file path for a file tool that has no title yet", () => {
    // OpenCode only sets a write/edit tool's title on completion — while the
    // tool runs, the file path in its input is the only thing worth showing.
    const s = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "write", status: "running", input: { filePath: "/Users/asq/Documents/OpenScience/2026-07-04/index.html", content: "<!doctype html>" } },
    ]);
    expect(s.blocks[0]).toMatchObject({
      kind: "tool-call",
      status: "running",
      title: "2026-07-04/index.html",
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

  it("carries a running bash step's live output tail, \\r-folded; completion clears it", () => {
    const s1 = foldAll([
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "bash", status: "running", input: { command: "python train.py", human_description: "Training the cohort prediction model" }, startedAt: 1000, partialOutput: "epoch 1:  10%\repoch 1:  50%\n" },
    ]);
    expect(s1.blocks[0]).toMatchObject({
      kind: "tool-call",
      title: "Training the cohort prediction model",
      verb: "Ran",
      naturalTitle: true,
      status: "running",
      partialOutput: "epoch 1:  50%\n",
      startedAt: 1000,
    });
    const s2 = foldAll(
      [{ type: "tool.updated", sessionId: S, callId: "c1", tool: "bash", status: "success", input: { command: "python train.py", human_description: "Training the cohort prediction model" }, output: "epoch 1: 100%\ndone\n", endedAt: 5000 }],
      s1,
    );
    expect(s2.blocks[0]).toMatchObject({
      kind: "tool-call",
      status: "success",
      output: "epoch 1: 100%\ndone",
      // startedAt survives from the running event; the tail is gone.
      startedAt: 1000,
      endedAt: 5000,
    });
    expect(s2.blocks[0]).not.toHaveProperty("partialOutput");
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

  it("deduplicates repeated session idle events", () => {
    const s = foldAll([
      { type: "text.updated", sessionId: S, partId: "p1", text: "done" },
      { type: "session.idle", sessionId: S },
      { type: "session.idle", sessionId: S },
    ]);
    expect(s.blocks.filter((b) => b.kind === "status-line" && b.tone === "done")).toHaveLength(1);
  });
});

describe("subagent activity", () => {
  it("records the child session id on a task tool block", () => {
    const s = foldAll([
      {
        type: "tool.updated",
        sessionId: S,
        callId: "c1",
        tool: "task",
        status: "running",
        title: "Visual QA for slides",
        childSessionId: "ses_child",
        input: {
          task: "Inspect every rendered slide",
          sandbox: "danger-full-access",
          tools: ["Bash", "ExecuteCode"],
          skills: ["slides", "visual-qa"],
          available_skill_count: 12,
        },
      },
    ]);
    expect(s.blocks[0]).toMatchObject({
      kind: "tool-call",
      childSessionId: "ses_child",
      subagentTask: "Inspect every rendered slide",
      subagentSandbox: "danger-full-access",
      subagentTools: ["Bash", "ExecuteCode"],
      subagentSkills: ["slides", "visual-qa"],
      subagentAvailableSkillCount: 12,
    });
  });

  it("subagentActivity: shows the child's latest tool step", () => {
    const child = foldAll([
      { type: "tool.updated", sessionId: "ses_child", callId: "k1", tool: "bash", status: "success", title: "pdftoppm -jpeg slides.pdf", input: { human_description: "Rendering the slide deck pages" } },
      { type: "tool.updated", sessionId: "ses_child", callId: "k2", tool: "bash", status: "running", title: "python3 analyze slide-03.jpg", input: { human_description: "Inspecting the rendered slide image" } },
    ]);
    expect(subagentActivity(child.blocks)).toBe("Inspecting the rendered slide image");
  });

  it("subagentActivity: 'Writing…' while the child is streaming text", () => {
    const child = foldAll([
      { type: "tool.updated", sessionId: "ses_child", callId: "k1", tool: "bash", status: "success", title: "ls" },
      { type: "text.updated", sessionId: "ses_child", partId: "p1", text: "Compiling the final report" },
    ]);
    expect(subagentActivity(child.blocks)).toBe("Writing…");
  });

  it("subagentActivity: 'Working…' when nothing is known yet", () => {
    expect(subagentActivity(undefined)).toBe("Working…");
    expect(subagentActivity([])).toBe("Working…");
  });

  it("keeps the child link when a later update omits it", () => {
    const s = foldAll([
      {
        type: "tool.updated",
        sessionId: S,
        callId: "c1",
        tool: "task",
        status: "running",
        title: "Visual QA for slides",
        childSessionId: "ses_child",
      },
      { type: "tool.updated", sessionId: S, callId: "c1", tool: "task", status: "running", title: "Visual QA for slides" },
    ]);
    expect(s.blocks[0]).toMatchObject({ kind: "tool-call", childSessionId: "ses_child" });
  });
});

describe("historyToThread", () => {
  it("restores an audited skill load from persisted history", () => {
    const t = historyToThread([
      {
        role: "assistant",
        parts: [
          {
            type: "tool",
            tool: "skill",
            state: {
              status: "completed",
              title: "Loaded open-targets skill",
              input: {
                action: "load",
                name: "open-targets",
                source: "user",
                path: "/home/.agents/skills/open-targets/SKILL.md",
              },
              output: "# Open Targets",
              time: { start: 100, end: 161 },
            },
          },
        ],
      },
    ]);
    expect(t.blocks[0]).toMatchObject({
      kind: "tool-call",
      tool: "skill",
      skillName: "open-targets",
      output: "# Open Targets",
      startedAt: 100,
      endedAt: 161,
    });
  });

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

  it("restores rich web research instead of exposing its JSON envelope", () => {
    const output = JSON.stringify({
      kind: "fetch",
      url: "https://www.fda.gov/label",
      answer: "FDA label summary",
      sources: [{ title: "FDA label", url: "https://www.fda.gov/label" }],
      result_count: 1,
      duration_ms: 400,
    });
    const t = historyToThread([{ role: "assistant", parts: [{
      type: "tool",
      tool: "webfetch",
      state: {
        status: "completed",
        title: "Reading FDA label",
        input: { url: "https://www.fda.gov/label", human_description: "Reading FDA label" },
        output,
      },
    }] }]);
    expect(t.blocks[0]).toMatchObject({
      kind: "tool-call",
      tool: "webfetch",
      naturalTitle: true,
      webResult: {
        kind: "fetch",
        answer: "FDA label summary",
        resultCount: 1,
      },
    });
    expect(t.blocks[0]).not.toHaveProperty("output");
  });

  it("removes persisted empty Codex web-search placeholders", () => {
    const t = historyToThread([{ role: "assistant", parts: [{
      type: "tool",
      tool: "websearch",
      state: {
        status: "completed",
        title: "web search",
        input: { pattern: "" },
      },
    }] }]);
    expect(t.blocks).toEqual([]);
  });

  it("restores a persisted subagent parent/child link on task history", () => {
    const t = historyToThread([{ role: "assistant", parts: [{
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        title: "Literature Agent — evidence returned",
        input: {
          task: "Review the MC4R clinical literature",
          sandbox: "workspace-write",
          tools: ["Live web research", "Bash"],
          skills: ["paperclip"],
          available_skill_count: 9,
        },
        metadata: { sessionId: "ses_literature_1" },
      },
    }] }]);
    expect(t.blocks[0]).toMatchObject({
      kind: "tool-call",
      tool: "task",
      childSessionId: "ses_literature_1",
      subagentTask: "Review the MC4R clinical literature",
      subagentSandbox: "workspace-write",
      subagentTools: ["Live web research", "Bash"],
      subagentSkills: ["paperclip"],
      subagentAvailableSkillCount: 9,
    });
  });

  it("renders a user-run '!' shell turn like the live path: '! cmd' + inline output", () => {
    // OpenCode records a "!" run as a synthetic user text + a bash tool part.
    const msgs: HistoryMessage[] = [
      {
        role: "user",
        parts: [{ type: "text", text: "The following tool was executed by the user", synthetic: true }],
      },
      {
        role: "assistant",
        parts: [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", title: "", input: { command: "pwd", human_description: "Running direct shell command" }, output: "/ws/here\n" },
          },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks).toEqual([
      { kind: "user", text: "! pwd" },
      {
        kind: "tool-call",
        title: "Running direct shell command",
        verb: "Ran",
        naturalTitle: true,
        tool: "bash",
        command: "pwd",
        status: "success",
        output: "/ws/here",
        outputSummary: "/ws/here",
      },
    ]);
  });

  it("shows an explicit missing-description state for historical agent steps", () => {
    const msgs: HistoryMessage[] = [
      {
        role: "assistant",
        parts: [
          { type: "tool", tool: "bash", state: { status: "completed", title: "", input: { command: "ls -la" } } },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks[0]).toMatchObject({
      kind: "tool-call",
      title: "Missing activity description",
      naturalTitle: true,
    });
    // An agent bash step (no synthetic marker) never shows inline output.
    expect(t.blocks[0]).not.toHaveProperty("outputSummary");
  });

  it("never spins in history: frozen running/pending steps become quiet + one interrupted line", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "explore" }] },
      {
        role: "assistant",
        parts: [
          { type: "tool", tool: "read", state: { status: "running", title: "README.md" } },
          { type: "tool", tool: "glob", state: { status: "pending", title: "*.md" } },
        ],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks[1]).toMatchObject({ kind: "tool-call", status: "pending" });
    expect(t.blocks[2]).toMatchObject({ kind: "tool-call", status: "pending" });
    const last = t.blocks[t.blocks.length - 1];
    expect(last).toMatchObject({ kind: "status-line", tone: "error" });
  });

  it("shows a slash command as what the user typed, not its expanded template", () => {
    // OpenCode stores the EXPANDED command/skill template as the user message,
    // with typed arguments appended — reverse-map via the known templates.
    const template = "\nThis skill guides growth for indie AI products…\n\n## Core Philosophy\n…";
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: template.trim() }] },
      { role: "assistant", parts: [{ type: "text", text: "on it" }] },
      { role: "user", parts: [{ type: "text", text: `${template.trim()}\n\n帮我设计增长方式` }] },
    ];
    const t = historyToThread(msgs, [
      { name: "growth-marketing", source: "skill", template },
    ]);
    expect(t.blocks[0]).toEqual({ kind: "user", text: "/growth-marketing" });
    expect(t.blocks[2]).toEqual({ kind: "user", text: "/growth-marketing 帮我设计增长方式" });
  });

  it("leaves a long pasted user text alone when it matches no template", () => {
    const msgs: HistoryMessage[] = [
      { role: "user", parts: [{ type: "text", text: "a genuinely long pasted question…" }] },
    ];
    const t = historyToThread(msgs, [{ name: "init", template: "something else" }]);
    expect(t.blocks[0]).toEqual({ kind: "user", text: "a genuinely long pasted question…" });
  });

  it("adds no interrupted line when every step finished", () => {
    const msgs: HistoryMessage[] = [
      {
        role: "assistant",
        parts: [{ type: "tool", tool: "read", state: { status: "completed", title: "README.md" } }],
      },
    ];
    const t = historyToThread(msgs);
    expect(t.blocks.every((b) => b.kind !== "status-line")).toBe(true);
  });
});
