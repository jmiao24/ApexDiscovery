import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FigureBlock } from "./FigureBlock";

const block = {
  kind: "figure" as const,
  title: "atlas_fig1a.png",
  src: "data:image/svg+xml;utf8,<svg/>",
  caption: "138 species",
  annotation: { index: 1, note: "these labels are hard to see", x: 72, y: 64 },
};

describe("FigureBlock", () => {
  it("renders the figure and caption", () => {
    render(<FigureBlock block={block} />);
    expect(screen.getByAltText("atlas_fig1a.png")).toBeInTheDocument();
    expect(screen.getByText("138 species")).toBeInTheDocument();
  });

  it("opens the annotation popover with a Send action", async () => {
    render(<FigureBlock block={block} />);
    await userEvent.click(screen.getByRole("button", { name: "Annotation 1" }));
    expect(await screen.findByText("these labels are hard to see")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});
