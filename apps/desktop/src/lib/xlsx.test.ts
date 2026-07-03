import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { workbookSheets } from "./xlsx";

describe("workbookSheets", () => {
  it("renders every sheet to an HTML table, keeping merged cells as spans", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Report title", ""],
      ["name", "value"],
      ["moon", 42],
    ]);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["only one cell"]]), "Notes");

    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const sheets = workbookSheets(bytes);

    expect(sheets.map((s) => s.name)).toEqual(["Data", "Notes"]);
    expect(sheets[0].html).toContain("<table");
    expect(sheets[0].html).toContain("Report title");
    expect(sheets[0].html).toMatch(/colspan="2"/);
    expect(sheets[0].truncated).toBe(false);
    expect(sheets[1].html).toContain("only one cell");
  });

  it("escapes HTML in cell values", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["<img src=x>"]]), "S");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(workbookSheets(bytes)[0].html).not.toContain("<img");
  });
});
