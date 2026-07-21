import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";

describe("Sidebar i18n", () => {
  it("renders the minimal navigation and section heading in English", async () => {
    renderAt("/files");

    expect(screen.getByText("APEX Discovery")).toBeInTheDocument();
    expect(document.querySelector('img[src="/apex-mark.svg"]')).not.toBeInTheDocument();
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getByText("New")).toBeInTheDocument();
    expect(within(nav).queryByText("Files")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Runs")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Skills")).not.toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});
