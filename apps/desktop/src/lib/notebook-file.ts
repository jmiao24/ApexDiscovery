import type { NotebookCell } from "@ai4s/shared";

/** Minimal nbformat-4 shapes we read and write. */
interface IpynbOutput {
  output_type: string;
  text?: string | string[];
  data?: { "text/plain"?: string | string[] };
  ename?: string;
  evalue?: string;
  traceback?: string[];
}
interface IpynbCell {
  cell_type: string;
  source: string | string[];
  outputs?: IpynbOutput[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
}
interface Ipynb {
  cells: IpynbCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

const joinSource = (s: string | string[] | undefined): string =>
  Array.isArray(s) ? s.join("") : (s ?? "");

function outputText(outputs: IpynbOutput[] | undefined): string | undefined {
  if (!outputs?.length) return undefined;
  const parts = outputs.map((o) => {
    if (o.output_type === "stream") return joinSource(o.text);
    if (o.output_type === "execute_result" || o.output_type === "display_data")
      return joinSource(o.data?.["text/plain"]);
    if (o.output_type === "error")
      return o.traceback?.join("\n") ?? `${o.ename}: ${o.evalue}`;
    return "";
  });
  const text = parts
    .map((p) => p.trimEnd())
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

/** Parse .ipynb JSON into the app's cell model. Throws on non-notebook JSON. */
export function parseIpynb(json: string): NotebookCell[] {
  const nb = JSON.parse(json) as Ipynb;
  if (!Array.isArray(nb.cells)) throw new Error("not a Jupyter notebook (no cells array)");
  return nb.cells.map((cell, i) => ({
    index: i + 1,
    language: cell.cell_type === "code" ? "python" : cell.cell_type,
    code: joinSource(cell.source),
    output: cell.cell_type === "code" ? outputText(cell.outputs) : undefined,
  }));
}

/** Serialize the app's cell model back to nbformat 4.5 JSON. */
export function serializeIpynb(cells: NotebookCell[]): string {
  const nb: Ipynb = {
    cells: cells.map((c) => {
      if (c.language !== "python") {
        return { cell_type: c.language, source: c.code, metadata: {} };
      }
      const outputs: IpynbOutput[] = c.output
        ? [{ output_type: "stream", text: c.output.endsWith("\n") ? c.output : `${c.output}\n` }]
        : [];
      return { cell_type: "code", source: c.code, outputs, metadata: {}, execution_count: null };
    }),
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return JSON.stringify(nb, null, 1);
}

/** A blank single-cell notebook document. */
export function emptyIpynb(): string {
  return serializeIpynb([{ index: 1, language: "python", code: "" }]);
}
