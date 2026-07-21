import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownViewer } from "./MarkdownViewer";

describe("MarkdownViewer links", () => {
  it("lets the app intercept an installed skill path", async () => {
    const onLinkClick = vi.fn(() => true);
    render(
      <MarkdownViewer onLinkClick={onLinkClick}>
        {"[evaluate-label-expansion](/Users/test/.codex/skills/evaluate-label-expansion/SKILL.md)"}
      </MarkdownViewer>,
    );

    await userEvent.click(screen.getByRole("link", { name: "evaluate-label-expansion" }));
    expect(onLinkClick).toHaveBeenCalledWith(
      "/Users/test/.codex/skills/evaluate-label-expansion/SKILL.md",
    );
    expect(window.location.pathname).not.toContain("SKILL.md");
  });
});
