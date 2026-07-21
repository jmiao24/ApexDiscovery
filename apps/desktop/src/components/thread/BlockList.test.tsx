import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BlockList } from "./BlockList";

describe("BlockList", () => {
  it("feeds a running task row the live activity of its subagent", () => {
    render(
      <BlockList
        blocks={[
          { kind: "tool-call", title: "Visual QA for slides", status: "running", childSessionId: "ses_child" },
        ]}
        handlers={{
          subagentActivity: (id) => (id === "ses_child" ? "python3 analyze slide-03.jpg" : undefined),
        }}
      />,
    );
    expect(screen.getByText("python3 analyze slide-03.jpg")).toBeInTheDocument();
  });

  it("asks for no activity on rows that spawned no subagent", () => {
    render(
      <BlockList
        blocks={[{ kind: "tool-call", title: "ls -la", status: "running" }]}
        handlers={{
          subagentActivity: () => {
            throw new Error("must not be called without a childSessionId");
          },
        }}
      />,
    );
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  it("keeps every child action under the task and opens the full child session", () => {
    const onSubagentOpen = vi.fn();
    const onSubagentCancel = vi.fn();
    render(
      <BlockList
        blocks={[
          {
            kind: "tool-call",
            tool: "task",
            title: "Literature Agent — researching evidence",
            status: "running",
            childSessionId: "ses_literature",
            subagentName: "Claude Agent",
            subagentTask: "Find primary evidence for MC4R obesity programs",
            subagentSandbox: "danger-full-access",
            subagentTools: ["Live web research", "Bash", "ExecuteCode"],
            subagentSkills: ["paperclip", "open-targets"],
            subagentAvailableSkillCount: 14,
          },
        ]}
        handlers={{
          subagentActivity: () => "Querying ClinicalTrials.gov",
          subagentTrace: () => [
            {
              kind: "tool-call",
              tool: "websearch",
              verb: "Searched",
              title: "MC4R obesity clinical trials",
              status: "success",
            },
            {
              kind: "tool-call",
              tool: "websearch",
              verb: "Searched",
              title: "Querying ClinicalTrials.gov",
              status: "running",
            },
          ],
          onSubagentOpen,
          onSubagentCancel,
        }}
      />,
    );

    expect(screen.getByText("Claude Agent")).toBeInTheDocument();
    expect(screen.getByText("Find primary evidence for MC4R obesity programs")).toBeInTheDocument();
    expect(screen.getByText("Full access")).toBeInTheDocument();
    expect(screen.getByText("Cannot launch subagents")).toBeInTheDocument();
    expect(screen.getByText("Live web research")).toBeInTheDocument();
    expect(screen.getByText("$paperclip")).toBeInTheDocument();
    expect(screen.getByText("14 available")).toBeInTheDocument();
    expect(screen.getByText("MC4R obesity clinical trials")).toBeInTheDocument();
    expect(screen.getAllByText("Querying ClinicalTrials.gov")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancel subagent" }));
    expect(onSubagentCancel).toHaveBeenCalledWith("ses_literature");
    fireEvent.click(screen.getByRole("button", { name: "Open full task" }));
    expect(onSubagentOpen).toHaveBeenCalledWith("ses_literature");
  });

  it("retains a completed child's collapsed trace for later inspection", () => {
    render(
      <BlockList
        blocks={[
          {
            kind: "tool-call",
            tool: "task",
            title: "Literature Agent — evidence returned",
            status: "success",
            childSessionId: "ses_literature",
          },
        ]}
        handlers={{
          subagentTrace: () => [
            { kind: "tool-call", tool: "websearch", verb: "Searched", title: "PubMed", status: "success" },
            { kind: "tool-call", tool: "websearch", verb: "Searched", title: "ClinicalTrials.gov", status: "success" },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Literature Agent/ }));
    const summary = screen.getByRole("button", { name: /Ran 2 searches/ });
    fireEvent.click(summary);
    expect(screen.getByText("PubMed")).toBeInTheDocument();
    expect(screen.getByText("ClinicalTrials.gov")).toBeInTheDocument();
  });
});
