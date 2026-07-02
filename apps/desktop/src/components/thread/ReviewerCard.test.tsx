import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReviewerCard } from "./ReviewerCard";

const block = {
  kind: "reviewer" as const,
  findings: [
    { level: "warn" as const, title: "Duplicate PMID in plan", evidence: "same PMID for two papers" },
  ],
};

describe("ReviewerCard", () => {
  it("shows the finding badge and title, expanded by default", () => {
    render(<ReviewerCard block={block} />);
    expect(screen.getByText("Warn")).toBeInTheDocument();
    expect(screen.getByText("Duplicate PMID in plan")).toBeInTheDocument();
    expect(screen.getByText("same PMID for two papers")).toBeInTheDocument();
    expect(screen.getByText("· 1 finding")).toBeInTheDocument();
  });

  it("collapses when the header is clicked", async () => {
    render(<ReviewerCard block={block} />);
    await userEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("same PMID for two papers")).not.toBeInTheDocument();
  });
});
