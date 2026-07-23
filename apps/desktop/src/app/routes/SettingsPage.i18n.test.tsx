import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";

describe("Settings page strings (i18n)", () => {
  it("renders the page title, subtitle, and card titles in English", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(
      screen.getByText("Everything here configures the bundled APEX Runtime — one config, no copies."),
    ).toBeInTheDocument();
    expect(screen.getByText("Agent runtime")).toBeInTheDocument();
    expect(screen.getByText("MCP servers")).toBeInTheDocument();
    expect(screen.getByText("ExecuteCode network")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
  });

  it("renders the disconnected-runtime prompts and the Workspace fallback text", async () => {
    renderAt("/settings");
    expect(await screen.findByText("Connect the runtime to configure models.")).toBeInTheDocument();
    expect(screen.getByText("Connect the runtime to configure MCP servers.")).toBeInTheDocument();
    expect(screen.getByText("Connect the runtime to configure ExecuteCode network access.")).toBeInTheDocument();
    expect(screen.getByText("available in the desktop app")).toBeInTheDocument();
  });
});
