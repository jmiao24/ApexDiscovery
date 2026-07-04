import { describe, expect, it } from "vitest";
import { MAX_MOLECULES, parseMoleculeFile } from "./molecule";

describe("parseMoleculeFile", () => {
  it("reads a single .mol file, taking its title line as the name", () => {
    const molfile = "benzene\n  test\n\n  0  0\nM  END\n";
    const { entries, truncated } = parseMoleculeFile("benzene.mol", molfile);
    expect(truncated).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("benzene");
    expect(entries[0].format).toBe("molfile");
    expect(entries[0].source).toBe(molfile);
  });

  it("splits an .sdf into records on the $$$$ delimiter", () => {
    const sdf = "mol-a\n  x\n\nM  END\n$$$$\nmol-b\n  y\n\nM  END\n$$$$\n";
    const { entries } = parseMoleculeFile("library.sdf", sdf);
    expect(entries.map((e) => e.name)).toEqual(["mol-a", "mol-b"]);
    expect(entries.every((e) => e.format === "molfile")).toBe(true);
  });

  it("keeps blank .sdf title lines so the fixed-position header is not shifted", () => {
    // Unnamed exports (e.g. RDKit) have an EMPTY first line — trimming it away
    // would move the counts line out of molfile line 4 and parse 0 atoms.
    const record = "\n  RDKit          2D\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\nM  END";
    const sdf = `${record}\n$$$$\n${record}\n$$$$\n`;
    const { entries } = parseMoleculeFile("unnamed.sdf", sdf);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.source).toBe(record); // leading blank title line intact
      expect(e.name).toMatch(/^Structure \d$/);
    }
  });

  it("reads .smi lines as SMILES with an optional name, skipping comments", () => {
    const smi = "# a comment\nc1ccccc1 benzene\nCCO ethanol\n\nCN1C=NC2=C1 partial\n";
    const { entries } = parseMoleculeFile("mols.smi", smi);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ name: "benzene", source: "c1ccccc1", format: "smiles" });
    expect(entries[1]).toMatchObject({ name: "ethanol", source: "CCO" });
  });

  it("names unnamed SMILES positionally", () => {
    const { entries } = parseMoleculeFile("x.smiles", "CCO\nCCC\n");
    expect(entries.map((e) => e.name)).toEqual(["Structure 1", "Structure 2"]);
  });

  it("caps huge libraries and reports how many were dropped", () => {
    const smi = Array.from({ length: MAX_MOLECULES + 5 }, () => "CCO").join("\n");
    const { entries, truncated } = parseMoleculeFile("big.smi", smi);
    expect(entries).toHaveLength(MAX_MOLECULES);
    expect(truncated).toBe(5);
  });
});
