import { describe, expect, it } from "vitest";
import { skillInspectorFromBlock } from "./skills";

describe("skillInspectorFromBlock", () => {
  it("builds the right-pane model only for an audited skill load", () => {
    expect(
      skillInspectorFromBlock({
        kind: "tool-call",
        tool: "skill",
        title: "Loaded open-targets skill",
        status: "success",
        skillName: "open-targets",
        skillPath: "/home/.agents/skills/open-targets/SKILL.md",
        skillSource: "user",
        output: "# Open Targets",
        startedAt: 100,
        endedAt: 161,
      }),
    ).toEqual({
      variant: "skill",
      name: "open-targets",
      path: "/home/.agents/skills/open-targets/SKILL.md",
      source: "user",
      content: "# Open Targets",
      startedAt: 100,
      endedAt: 161,
    });
  });

  it("rejects ordinary tool rows", () => {
    expect(
      skillInspectorFromBlock({ kind: "tool-call", tool: "bash", title: "pwd", status: "success" }),
    ).toBeNull();
  });
});
