// Minimal RFC-4180-ish CSV/TSV parsing for table previews. Handles quoted
// fields (embedded delimiters, quotes, newlines); caps rows so a huge file
// can't lock the UI.

export interface ParsedTable {
  columns: string[];
  rows: string[][];
  truncated: boolean;
}

export function parseDelimited(text: string, delimiter: "," | "\t", maxRows = 500): ParsedTable {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let truncated = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Skip fully-empty trailing lines.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delimiter) {
      pushField();
    } else if (c === "\n") {
      pushRow();
      if (rows.length > maxRows) {
        truncated = true;
        break;
      }
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (!truncated && (field !== "" || row.length > 0)) pushRow();

  const columns = rows.shift() ?? [];
  return { columns, rows: rows.slice(0, maxRows), truncated };
}

/** Parse CSV or TSV by filename extension. */
export function parseTableFile(filename: string, text: string): ParsedTable {
  const delim = filename.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  return parseDelimited(text, delim as "," | "\t");
}
