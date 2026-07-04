import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MAX_MOLECULES, parseMoleculeFile, type MolEntry } from "@/lib/molecule";

interface Rendered {
  name: string;
  svg: string | null; // null = this entry could not be parsed
}

/**
 * Native 2D structure renderer (P1-3) for chemical files (.mol / .sdf / .smi).
 * openchemlib depicts each structure as an SVG entirely locally — no service,
 * no WebGL. Structures render on a white card (chemistry convention) so they
 * read the same in light and dark themes. SDF libraries render as a gallery.
 */
export function MoleculeView({ filename, text }: { filename: string; text: string }) {
  const [molecules, setMolecules] = useState<Rendered[] | null>(null);
  const [truncated, setTruncated] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMolecules(null);
    setError(null);
    (async () => {
      try {
        const { entries, truncated } = parseMoleculeFile(filename, text);
        if (entries.length === 0) {
          if (!cancelled) setError("No chemical structures found in this file.");
          return;
        }
        // Lazy-load the renderer so it stays out of the main bundle.
        const OCL = await import("openchemlib");
        const rendered = entries.map((e) => renderOne(OCL, e));
        if (!cancelled) {
          setMolecules(rendered);
          setTruncated(truncated);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filename, text]);

  if (error) return <div className="p-4 text-sm text-muted">{error}</div>;
  if (molecules === null) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" /> Rendering structure…
      </div>
    );
  }

  const single = molecules.length === 1;
  return (
    <div className="p-4">
      <div className={single ? "" : "grid grid-cols-2 gap-3 sm:grid-cols-3"}>
        {molecules.map((m, i) => (
          <figure
            key={i}
            className="overflow-hidden rounded-card border border-border bg-white shadow-card"
          >
            <div
              className={single ? "flex justify-center p-4" : "flex justify-center p-2"}
              // openchemlib returns a self-contained SVG string; render it inline.
              dangerouslySetInnerHTML={{
                __html: m.svg ?? '<div style="color:#888;font:12px sans-serif;padding:1rem">could not render</div>',
              }}
            />
            <figcaption className="truncate border-t border-border/60 bg-surface px-2 py-1 text-center text-xs text-muted">
              {m.name}
            </figcaption>
          </figure>
        ))}
      </div>
      {truncated > 0 && (
        <p className="mt-3 text-center text-xs text-muted">
          Showing the first {MAX_MOLECULES} of {MAX_MOLECULES + truncated} structures.
        </p>
      )}
    </div>
  );
}

/** Depict one entry as an SVG, or null if openchemlib rejects its source. */
function renderOne(OCL: typeof import("openchemlib"), e: MolEntry): Rendered {
  try {
    const mol =
      e.format === "smiles" ? OCL.Molecule.fromSmiles(e.source) : OCL.Molecule.fromMolfile(e.source);
    if (mol.getAllAtoms() === 0) return { name: e.name, svg: null };
    return { name: e.name, svg: mol.toSVG(360, 260, undefined, { autoCrop: true, suppressChiralText: true }) };
  } catch {
    return { name: e.name, svg: null };
  }
}
