import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";
import { useUiStore } from "@/lib/store";
import { shippedLocales } from "@/i18n/config";

describe("Settings language selector", () => {
  it("shows a Language control with one option per shipped locale", async () => {
    renderAt("/settings");
    const select = await screen.findByLabelText("Language");
    expect(select.querySelectorAll("option")).toHaveLength(shippedLocales().length);
  });

  it("updates the store locale on change", async () => {
    renderAt("/settings");
    const select = await screen.findByLabelText("Language");
    await userEvent.selectOptions(select, "ja");
    expect(useUiStore.getState().locale).toBe("ja");
    useUiStore.getState().setLocale("en");
  });
});

describe("Settings page strings (i18n)", () => {
  it("renders the page title, subtitle, and card titles in English", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(
      screen.getByText("Everything here configures the bundled OpenCode runtime — one config, no copies."),
    ).toBeInTheDocument();
    expect(screen.getByText("Agent runtime")).toBeInTheDocument();
    expect(screen.getByText("MCP servers")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
  });

  it("renders the disconnected-runtime prompts and the Workspace fallback text", async () => {
    renderAt("/settings");
    expect(await screen.findByText("Connect the runtime to configure models.")).toBeInTheDocument();
    expect(screen.getByText("Connect the runtime to configure MCP servers.")).toBeInTheDocument();
    expect(screen.getByText("available in the desktop app")).toBeInTheDocument();
  });
});
