import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WORKFLOW_STARTERS, WorkflowStarters } from "./WorkflowStarters";

describe("WorkflowStarters", () => {
  it("renders one card per starter workflow", () => {
    render(<WorkflowStarters onPick={() => {}} />);
    for (const s of WORKFLOW_STARTERS) {
      expect(screen.getByText(s.title)).toBeInTheDocument();
    }
  });

  it("sends the full-workflow prompt on click", async () => {
    const onPick = vi.fn();
    render(<WorkflowStarters onPick={onPick} />);
    await userEvent.click(screen.getByText("Demo: analysis end to end"));
    expect(onPick).toHaveBeenCalledWith(expect.stringContaining("figure1.png"));
    expect(onPick.mock.calls[0][0]).toContain("report.md");
  });
});
