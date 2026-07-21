import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";

describe("RunsPage strings (i18n)", () => {
  it("renders the page heading and description in English", async () => {
    renderAt("/runs");
    expect(await screen.findByRole("heading", { level: 1, name: "Runs" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Every experiment execution across all sessions — command, code version, environment, hardware, and outputs\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Reproduce")).toBeInTheDocument();
  });

  it("renders the empty state (no runs recorded) in English", async () => {
    renderAt("/runs");
    expect(await screen.findByText("No runs recorded yet")).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === "When the agent runs code (e.g. python train.py), each execution is recorded here with its reproducibility recipe."),
    ).toBeInTheDocument();
  });
});
