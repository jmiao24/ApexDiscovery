// Parse a workbook into per-sheet HTML tables for the previewer (SheetJS —
// robust against charts/drawings, which it simply ignores). sheet_to_html
// keeps merged cells as rowspan/colspan, so layouts with title rows render
// the way Excel/WPS shows them. Pure so it can be unit-tested without DOM;
// caps keep a huge sheet from locking the UI.
import * as XLSX from "xlsx";

export interface SheetHtml {
  name: string;
  /** A bare `<table>` fragment (cell text is HTML-escaped by SheetJS). */
  html: string;
  truncated: boolean;
}

const MAX_ROWS = 500;
const MAX_COLS = 50;

export function workbookSheets(bytes: ArrayBuffer): SheetHtml[] {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws["!ref"];
    let truncated = false;
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      const capped = {
        s: range.s,
        e: {
          r: Math.min(range.e.r, range.s.r + MAX_ROWS - 1),
          c: Math.min(range.e.c, range.s.c + MAX_COLS - 1),
        },
      };
      truncated = capped.e.r < range.e.r || capped.e.c < range.e.c;
      if (truncated) ws["!ref"] = XLSX.utils.encode_range(capped);
    }
    const html = XLSX.utils.sheet_to_html(ws, { header: "", footer: "" });
    if (ref) ws["!ref"] = ref;
    return { name, html, truncated };
  });
}
