import { describe, expect, it } from "vitest";
import { formatNumber } from "./format";

describe("formatNumber", () => {
  it("uses English grouping", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});
