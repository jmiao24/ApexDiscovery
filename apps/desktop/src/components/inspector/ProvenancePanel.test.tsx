import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvenanceRecord } from "@ai4s/shared";
import { ProvenancePanel } from "./ProvenancePanel";

const records: ProvenanceRecord[] = [
  { path: "fig/plot.py", version: 1, ts: 1751500000, tool: "write", content: "print(1)", sessionId: "ses_1" },
  { path: "fig/plot.py", version: 2, ts: 1751503600, tool: "edit", content: "print(2)", model: "anthropic/claude", sessionId: "ses_1" },
];

const listProvenance = vi.fn();
vi.mock("@/lib/provenance", () => ({
  listProvenance: (path: string) => listProvenance(path),
}));

const renderPanel = () =>
  render(
    <MemoryRouter>
      <ProvenancePanel path="fig/plot.py" language="python" />
    </MemoryRouter>,
  );

/** Highlighting splits code across spans — match the whole <code> element. */
const codeBlock = (text: string) => (_: string, el: Element | null) =>
  el?.tagName === "CODE" && el.textContent === text;

describe("ProvenancePanel", () => {
  beforeEach(() => listProvenance.mockReset());

  it("lists versions newest first with the latest expanded", async () => {
    listProvenance.mockResolvedValue(records);
    renderPanel();

    expect(await screen.findByText("v2")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("v2");
    expect(items[1]).toHaveTextContent("v1");
    // Latest version starts expanded: its code, model, and session link show.
    expect(screen.getByText(codeBlock("print(2)"))).toBeInTheDocument();
    expect(screen.getByText("anthropic/claude")).toBeInTheDocument();
    expect(screen.getByText("Open conversation")).toBeInTheDocument();
  });

  it("expands an older version to reveal its code", async () => {
    listProvenance.mockResolvedValue(records);
    renderPanel();

    await userEvent.click(await screen.findByText("v1"));
    expect(screen.getByText(codeBlock("print(1)"))).toBeInTheDocument();
  });

  it("explains the empty state", async () => {
    listProvenance.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/No versions recorded yet/)).toBeInTheDocument();
    expect(screen.getByText("fig/plot.py")).toBeInTheDocument();
  });
});
