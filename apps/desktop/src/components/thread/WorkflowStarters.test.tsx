import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WORKFLOW_STARTERS, WorkflowStarters } from "./WorkflowStarters";

describe("WorkflowStarters", () => {
  it("renders four label-expansion starter workflows", () => {
    render(<WorkflowStarters onPick={() => {}} />);
    expect(screen.getByText("Molecules Opportunity Atlas")).toBeInTheDocument();
    expect(screen.getByText("Rank label-expansion opportunities")).toBeInTheDocument();
    expect(screen.getByText("Evaluate one new indication")).toBeInTheDocument();
    expect(screen.getByText("Compare two expansion candidates")).toBeInTheDocument();
    expect(screen.getByText("Find the decisive evidence gaps")).toBeInTheDocument();
    expect(screen.queryByText(/^Example:/)).not.toBeInTheDocument();
    expect(WORKFLOW_STARTERS).toHaveLength(4);
    expect(WORKFLOW_STARTERS.every((starter) => starter.prompt.startsWith("$evaluate-label-expansion"))).toBe(true);
  });

  it("starts a new query with the displayed example on click", async () => {
    const onPick = vi.fn();
    render(<WorkflowStarters onPick={onPick} />);
    await userEvent.click(screen.getByText("Evaluate one new indication"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(expect.stringContaining("TEZSPIRE (tezepelumab)"));
    expect(onPick).toHaveBeenCalledWith(expect.stringContaining("eosinophilic COPD"));
    expect(onPick.mock.calls[0][0]).toMatch(/^\$evaluate-label-expansion /);
  });
});
