import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ThreadBlock, ToolCallBlock } from "@ai4s/shared";
import { ToolGroup, groupToolBlocks, summarizeGroup } from "./ToolGroup";

const tool = (over: Partial<ToolCallBlock>): ToolCallBlock => ({
  kind: "tool-call",
  title: "pwd",
  status: "success",
  tool: "bash",
  verb: "Ran",
  ...over,
});

describe("groupToolBlocks", () => {
  it("folds consecutive quiet tool calls into one group; text breaks the run", () => {
    const blocks: ThreadBlock[] = [
      tool({ title: "a" }),
      tool({ title: "b" }),
      { kind: "agent", markdown: "thinking" },
      tool({ title: "c" }),
    ];
    const items = groupToolBlocks(blocks);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: "group", start: 0 });
    expect((items[0] as { blocks: ToolCallBlock[] }).blocks.map((b) => b.title)).toEqual(["a", "b"]);
    expect(items[1]).toMatchObject({ kind: "block", index: 2 });
    expect(items[2]).toMatchObject({ kind: "group", start: 3 });
  });

  it("failures stay in the group (routine agent trial-and-error, counted in the summary)", () => {
    const items = groupToolBlocks([
      tool({ title: "a" }),
      tool({ title: "boom", status: "failed" }),
      tool({ title: "b" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "group", start: 0 });
  });

  it("only a step waiting for the user breaks out of the group", () => {
    const items = groupToolBlocks([
      tool({ title: "a" }),
      tool({ title: "rm -rf build", status: "waiting-approval" }),
      tool({ title: "b" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["group", "block", "group"]);
  });

  it("keeps subagent, Reviewer, and Main-Agent fix phases visible between folded tool runs", () => {
    const items = groupToolBlocks([
      tool({ title: "python analyze.py" }),
      tool({ tool: "task", verb: undefined, title: "Literature Agent — researching evidence", childSessionId: "ses_child" }),
      tool({ title: "python extract.py" }),
      tool({ tool: "reviewer", verb: undefined, title: "Reviewer pass 1 — reviewing artifacts" }),
      tool({ title: "python stats_check.py" }),
      tool({ tool: "fix", verb: undefined, title: "Main Agent — fixing reviewer findings" }),
      tool({ title: "python analyze.py" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "group", "block", "group", "block", "group", "block", "group",
    ]);
  });

  it("uses a quiet blocked icon and omits the failed-count label", () => {
    const { container } = render(
      <ToolGroup
        blocks={[tool({}), tool({ status: "failed", output: "404 not found" })]}
      />,
    );
    expect(screen.getByText(/2 commands/)).toBeInTheDocument();
    expect(screen.getByText("2 steps")).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-ban")).toBeInTheDocument();
    expect(container.querySelector(".lucide-x")).not.toBeInTheDocument();
    expect(screen.getByText("404 not found")).toBeInTheDocument();
  });
});

describe("summarizeGroup", () => {
  it("counts per verb in first-seen order, capitalized", () => {
    expect(
      summarizeGroup([
        tool({}),
        tool({}),
        tool({ verb: "Created", tool: "write" }),
        tool({}),
      ]),
    ).toBe("Ran 3 commands, created a file");
  });
});

describe("ToolGroup", () => {
  it("collapses a settled group to its summary; expands on click", () => {
    render(<ToolGroup blocks={[tool({ title: "pwd" }), tool({ title: "ls" })]} />);
    const summary = screen.getByRole("button", { name: /Ran 2 commands/ });
    expect(summary).toBeInTheDocument();
    fireEvent.click(summary);
    expect(screen.getByText("pwd")).toBeInTheDocument();
    expect(screen.getByText("ls")).toBeInTheDocument();
  });

  it("opens a running group so its action list and live tail stay visible", () => {
    render(
      <ToolGroup
        blocks={[
          tool({ title: "ls" }),
          tool({
            title: "python train.py",
            status: "running",
            partialOutput: "epoch 1/2\nloss=0.51",
            startedAt: Date.now() - 5000,
          }),
        ]}
      />,
    );
    expect(screen.getByText("python train.py")).toBeInTheDocument();
    expect(screen.getByText(/loss=0\.51/)).toBeInTheDocument();
  });

  it("opens a failed group but keeps its code detail folded", () => {
    render(
      <ToolGroup
        blocks={[
          tool({ title: "resolve target" }),
          tool({
            tool: "execute_code",
            title: "query schema",
            status: "failed",
            command: "query_schema()",
            output: "unknown field",
          }),
        ]}
      />,
    );
    expect(screen.getByText("query schema")).toBeInTheDocument();
    expect(document.querySelector("[data-execute-code-detail]")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /query schema/ }));
    expect(document.querySelector("[data-execute-code-detail]")).toBeInTheDocument();
  });

  it("a single quiet step renders as a plain row, no group chrome", () => {
    render(<ToolGroup blocks={[tool({ title: "pwd" })]} />);
    expect(screen.getByText("pwd")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /command/ })).not.toBeInTheDocument();
  });

  it("expanding a bash row reveals the full command and output", () => {
    const { container } = render(
      <ToolGroup
        blocks={[
          tool({
            title: "python train.py",
            command: "python3.12 /usr/local/bin/paperclip skill --format markdown",
            output: "done ok",
          }),
        ]}
      />,
    );
    const row = screen.getByRole("button");
    fireEvent.click(row);
    expect(screen.getByText("SHELL")).toBeInTheDocument();
    expect(screen.getByText("COMMAND")).toBeInTheDocument();
    expect(screen.getByText("STDOUT")).toBeInTheDocument();
    expect(container.querySelector("[data-shell-command]")).toHaveTextContent("paperclip");
    expect(container.querySelector("[data-shell-command] .hljs-built_in")).toHaveTextContent("python3.12");
    expect(container.querySelector("[data-shell-command] .hljs-string")).toBeInTheDocument();
    expect(container.querySelector("[data-shell-command] .hljs-attribute")).toHaveTextContent("--format");
    expect(screen.getByText("done ok")).toBeInTheDocument();
  });

  it("shows a natural activity label without a redundant Ran prefix", () => {
    render(
      <ToolGroup
        blocks={[
          tool({
            title: "Building MC4R biologics opportunity table",
            naturalTitle: true,
            command: "python build_table.py",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Building MC4R biologics opportunity table")).toBeInTheDocument();
    expect(screen.queryByText("Ran")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(document.querySelector("[data-shell-command]")).toHaveTextContent("python build_table.py");
  });

  it("shows ExecuteCode detail only after the user opens the row", () => {
    const { container } = render(
      <ToolGroup
        blocks={[
          tool({
            tool: "execute_code",
            title: "Resolving MC4R Ensembl identifier",
            naturalTitle: true,
            command: "import requests\nensembl_id = resolve_target('MC4R')\nprint(ensembl_id)",
            language: "python",
            output: "ENSG00000166603",
          }),
        ]}
      />,
    );
    expect(screen.queryByText("REPL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("REPL")).toBeInTheDocument();
    expect(screen.getByText("INPUT")).toBeInTheDocument();
    expect(screen.getByText("STDOUT")).toBeInTheDocument();
    expect(screen.getByText(/resolve_target/)).toBeInTheDocument();
    expect(screen.getByText("ENSG00000166603")).toBeInTheDocument();
    expect(container.querySelector(".hljs-keyword")).toHaveTextContent("import");
    expect(container.querySelector("[data-execute-code-input]")).toHaveClass("bg-bg");
    expect(container.querySelector("[data-execute-code-output]")).toHaveClass("bg-bg");
  });

  it("expands a built-in web search into its exact query", () => {
    render(
      <ToolGroup
        blocks={[
          tool({
            tool: "websearch",
            verb: "Searched",
            title: "site:accessdata.fda.gov setmelanotide label",
            query: "site:accessdata.fda.gov setmelanotide label",
          }),
        ]}
      />,
    );
    expect(screen.queryByText("WEB SEARCH")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("WEB SEARCH")).toBeInTheDocument();
    expect(screen.getByText("QUERY")).toBeInTheDocument();
    expect(document.querySelector("[data-web-search-detail]")).toHaveTextContent(
      "site:accessdata.fda.gov setmelanotide label",
    );
  });

  it("expands APEX web research into summary and clickable sources", () => {
    render(
      <ToolGroup
        blocks={[
          tool({
            tool: "websearch",
            verb: "Searched",
            naturalTitle: true,
            title: "Checking FDA MC4R evidence",
            query: "MC4R FDA evidence",
            webResult: {
              kind: "search",
              query: "MC4R FDA evidence",
              answer: "The FDA label supports the indication.",
              sources: [{
                title: "FDA prescribing information",
                url: "https://www.fda.gov/example-label",
                context: "The FDA label supports the indication.",
              }],
              resultCount: 1,
              durationMs: 1250,
            },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("SUMMARY")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("SUMMARY")).toBeInTheDocument();
    expect(screen.getByText("SOURCES")).toBeInTheDocument();
    expect(screen.getByText("1 source · 1.3s")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /FDA prescribing information/ })).toHaveAttribute(
      "href",
      "https://www.fda.gov/example-label",
    );
  });

  it("labels exact-page research as WebFetch", () => {
    render(
      <ToolGroup
        blocks={[
          tool({
            tool: "webfetch",
            verb: "Fetched",
            title: "Reading FDA label",
            webResult: {
              kind: "fetch",
              url: "https://www.fda.gov/example-label",
              answer: "Label summary",
              sources: [],
              resultCount: 0,
              durationMs: 20,
            },
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("WEB FETCH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /example-label/ })).toHaveAttribute(
      "href",
      "https://www.fda.gov/example-label",
    );
  });

  it("renders an edit step's diff with add/del lines", () => {
    render(
      <ToolGroup
        blocks={[
          tool({
            tool: "edit",
            verb: "Edited",
            title: "config.yaml",
            diff: "- device: cpu\n+ device: mps",
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("- device: cpu")).toBeInTheDocument();
    expect(screen.getByText("+ device: mps")).toBeInTheDocument();
  });

  it("renders a skill load as an inspector row with millisecond timing", () => {
    let opened: ToolCallBlock | undefined;
    const skill = tool({
      tool: "skill",
      verb: undefined,
      title: "Loaded open-targets skill",
      skillName: "open-targets",
      skillPath: "/home/.agents/skills/open-targets/SKILL.md",
      startedAt: 100,
      endedAt: 161,
      output: "# Open Targets",
    });
    render(<ToolGroup blocks={[skill]} onToolOpen={(block) => { opened = block; }} />);
    expect(screen.getByText("61ms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(opened).toBe(skill);
  });

  it("opens an ExecuteCode trace notebook from its activity row", () => {
    const execute = tool({
      tool: "execute_code",
      title: "Calculating adjusted cohort size",
      notebookPath: "execution_trace/worker-0.ipynb",
      notebookCellIndex: 2,
    });
    let opened: ToolCallBlock | undefined;
    render(<ToolGroup blocks={[execute]} onToolOpen={(block) => { opened = block; }} />);
    fireEvent.click(screen.getByText("Calculating adjusted cohort size"));
    expect(opened).toBe(execute);
  });
});
