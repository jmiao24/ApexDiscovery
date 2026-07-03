import { describe, expect, it } from "vitest";
import { splitReview } from "./review";

describe("splitReview", () => {
  it("extracts a review fence into a reviewer block and cleans the text", () => {
    const md =
      "I reviewed the figure.\n\n```review\n" +
      JSON.stringify({
        findings: [
          { level: "ok", title: "Data traces to code", evidence: "make_fig.py L10" },
          { level: "bogus-level", title: "Missing seed" },
        ],
        note: "Overall solid.",
      }) +
      "\n```\n\nLet me know.";
    const { clean, review } = splitReview(md);
    expect(review).not.toBeNull();
    expect(review!.findings).toHaveLength(2);
    expect(review!.findings[0]).toMatchObject({ level: "ok", title: "Data traces to code" });
    expect(review!.findings[1].level).toBe("warn"); // unknown level coerced
    expect(review!.note).toBe("Overall solid.");
    expect(clean).not.toContain("```review");
    expect(clean).toContain("I reviewed the figure.");
  });

  it("leaves text untouched when there is no fence or the JSON is malformed", () => {
    expect(splitReview("plain answer").review).toBeNull();
    const malformed = "```review\n{not json}\n```";
    const r = splitReview(malformed);
    expect(r.review).toBeNull();
    expect(r.clean).toBe(malformed);
  });
});
