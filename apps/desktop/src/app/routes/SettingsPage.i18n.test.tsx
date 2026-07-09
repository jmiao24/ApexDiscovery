import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";
import { useUiStore } from "@/lib/store";
import { shippedLocales } from "@/i18n/config";

describe("Settings language selector", () => {
  it("shows a Language control with one option per shipped locale", async () => {
    renderAt("/settings");
    const select = await screen.findByLabelText("Language");
    expect(select.querySelectorAll("option")).toHaveLength(shippedLocales().length);
  });

  it("updates the store locale on change", async () => {
    renderAt("/settings");
    const select = await screen.findByLabelText("Language");
    await userEvent.selectOptions(select, "ja");
    expect(useUiStore.getState().locale).toBe("ja");
    useUiStore.getState().setLocale("en");
  });
});
