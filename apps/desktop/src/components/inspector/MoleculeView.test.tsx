import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoleculeView } from "./MoleculeView";

// Uses the real openchemlib (pure JS, runs in jsdom) — a genuine render check.
describe("MoleculeView", () => {
  it("renders a SMILES structure to an inline SVG with a caption", async () => {
    const { container } = render(<MoleculeView filename="mols.smi" text="CCO ethanol" />);
    // Wait for the caption (the spinner is also an <svg>, so query the figure).
    expect(await screen.findByText("ethanol")).toBeInTheDocument();
    expect(container.querySelector("figure svg")).toBeInTheDocument();
  });

  it("renders every record of an SDF as a gallery", async () => {
    const OCL = await import("openchemlib");
    // Build two real molfiles and join them into an SDF.
    const a = OCL.Molecule.fromSmiles("CCO").toMolfile();
    const b = OCL.Molecule.fromSmiles("c1ccccc1").toMolfile();
    const sdf = `ethanol\n${a.split("\n").slice(1).join("\n")}\n$$$$\nbenzene\n${b.split("\n").slice(1).join("\n")}\n$$$$\n`;

    const { container } = render(<MoleculeView filename="lib.sdf" text={sdf} />);
    await waitFor(() => expect(container.querySelectorAll("svg").length).toBe(2));
    expect(screen.getByText("ethanol")).toBeInTheDocument();
    expect(screen.getByText("benzene")).toBeInTheDocument();
  });

  it("explains an empty file instead of rendering nothing", async () => {
    render(<MoleculeView filename="empty.smi" text={"   \n\n"} />);
    expect(await screen.findByText(/No chemical structures found/)).toBeInTheDocument();
  });
});
