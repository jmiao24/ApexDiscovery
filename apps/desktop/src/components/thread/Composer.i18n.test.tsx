import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";
import { Composer } from "./Composer";
import { WorkflowStarters } from "./WorkflowStarters";

describe("Composer strings (i18n)", () => {
  it("renders the default placeholder and the approval-mode switch in English", () => {
    render(<Composer onSend={() => {}} approvalMode="approve" onApprovalModeChange={() => {}} />);
    expect(screen.getByPlaceholderText("Ask anything")).toBeInTheDocument();
    expect(screen.getByLabelText("Approval mode")).toHaveTextContent("Approve for me");
  });
});

describe("WorkflowStarters strings (i18n)", () => {
  it("renders the welcome copy and concise starter titles in English", () => {
    render(<WorkflowStarters onPick={() => {}} />);
    expect(screen.getByText("Powered by")).toBeInTheDocument();
    expect(screen.getByText("Molecules Opportunity Atlas")).toBeInTheDocument();
    expect(screen.getByText("Where is the next molecule opportunity?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Connect assets, targets, mechanisms, modalities, indications, and evidence in a traceable, source-linked map for scientific decisions.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Rank label-expansion opportunities")).toBeInTheDocument();
    expect(screen.queryByText(/^Example:/)).not.toBeInTheDocument();
  });
});

describe("LiveSessionPage strings (i18n)", () => {
  it("renders the disconnected-runtime card in English (no Tauri sidecar in tests)", async () => {
    renderAt("/live");
    expect(await screen.findByText("OpenCode runtime")).toBeInTheDocument();
    expect(
      screen.getByText((_, node) =>
        node?.textContent === "The desktop app runs a bundled OpenCode automatically. In the browser, start one with opencode serve and connect.",
      ),
    ).toBeInTheDocument();
  });
});
