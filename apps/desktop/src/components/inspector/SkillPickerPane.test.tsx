import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillPickerPane } from "./SkillPickerPane";

const SKILLS = [
  { name: "open-targets", description: "Query target-disease evidence" },
  { name: "paperclip", description: "Search biomedical literature" },
];

describe("SkillPickerPane", () => {
  it("searches and toggles skills in the right-side drawer", () => {
    const onChange = vi.fn();
    render(
      <SkillPickerPane
        skills={SKILLS}
        selected={["open-targets"]}
        onChange={onChange}
        onClose={vi.fn()}
        onManage={vi.fn()}
      />,
    );

    expect(screen.getAllByText("All skills")).toHaveLength(2);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), {
      target: { value: "literature" },
    });
    expect(screen.queryByText("open-targets")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle paperclip skill" }));
    expect(onChange).toHaveBeenCalledWith(["open-targets", "paperclip"]);
  });

  it("filters to selected skills and exposes close and manage actions", () => {
    const onClose = vi.fn();
    const onManage = vi.fn();
    render(
      <SkillPickerPane
        skills={SKILLS}
        selected={["paperclip"]}
        onChange={vi.fn()}
        onClose={onClose}
        onManage={onManage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Selected/ }));
    expect(screen.getByText("paperclip")).toBeInTheDocument();
    expect(screen.queryByText("open-targets")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Close skills" }));
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
