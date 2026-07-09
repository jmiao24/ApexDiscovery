import { describe, expect, it } from "vitest";
import i18n, { NAMESPACES } from "./index";

describe("i18n instance", () => {
  it("initializes with English and the full namespace set", () => {
    expect(i18n.language).toBe("en");
    expect(NAMESPACES).toContain("common");
    expect(NAMESPACES.length).toBe(7);
  });

  it("resolves a seeded key", () => {
    expect(i18n.t("common:actions.save")).toBe("Save");
  });

  it("falls back to English for a not-yet-translated language", async () => {
    await i18n.changeLanguage("ja");
    // ja/common.json is empty → falls back to en.
    expect(i18n.t("common:actions.save")).toBe("Save");
    await i18n.changeLanguage("en");
  });
});
