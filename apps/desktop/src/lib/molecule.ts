// Parse chemical structure files into individual molecule entries (P1-3).
// Pure and library-free so it can be unit-tested without loading the renderer;
// the actual 2D depiction (openchemlib → SVG) happens in MoleculeView.

export type MolFormat = "molfile" | "smiles";

export interface MolEntry {
  /** Display name, from the file when present, else a positional fallback. */
  name: string;
  /** The molfile text or SMILES string to hand the renderer. */
  source: string;
  format: MolFormat;
}

/** Render at most this many structures from one file (SDF libraries can be huge). */
export const MAX_MOLECULES = 24;

/**
 * Split a chemical file into molecule entries by extension:
 * - `.mol` — one MDL molfile.
 * - `.sdf` — records separated by `$$$$`; each record is a molfile whose first
 *   line is its title.
 * - `.smi` / `.smiles` — one molecule per line: `<SMILES> [name]`.
 * Returns `{ entries, truncated }`; `truncated` is how many were dropped past
 * the cap, so the UI can say so instead of silently hiding them.
 */
export function parseMoleculeFile(
  filename: string,
  text: string,
): { entries: MolEntry[]; truncated: number } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const all = ext === "smi" || ext === "smiles" ? parseSmiles(text) : parseMolfiles(ext, text);
  const entries = all.slice(0, MAX_MOLECULES);
  return { entries, truncated: Math.max(0, all.length - entries.length) };
}

function parseSmiles(text: string): MolEntry[] {
  const out: MolEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [smiles, ...rest] = trimmed.split(/\s+/);
    out.push({
      name: rest.join(" ") || `Structure ${out.length + 1}`,
      source: smiles,
      format: "smiles",
    });
  }
  return out;
}

function parseMolfiles(ext: string, text: string): MolEntry[] {
  if (ext === "sdf") {
    // Records end with a `$$$$` delimiter line (consumed with its newline so
    // no record starts with a stray line break); drop the trailing empty
    // record. Records must NOT be trimmed at the front — that would eat a
    // BLANK title line and shift the fixed-position molfile header.
    const records = text
      .split(/^\$\$\$\$[ \t]*(?:\r?\n|$)/m)
      .map((r) => r.trimEnd())
      .filter((r) => r.trim() !== "");
    return records.map((rec, i) => ({
      name: rec.split(/\r?\n/)[0]?.trim() || `Structure ${i + 1}`,
      source: rec,
      format: "molfile",
    }));
  }
  // A single .mol file; its first line is the title (often blank).
  const name = text.split(/\r?\n/)[0]?.trim();
  return [{ name: name || "Structure", source: text, format: "molfile" }];
}
