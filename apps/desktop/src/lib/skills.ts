import type { SkillInspector, ToolCallBlock } from "@ai4s/shared";

/** Build the auditable right-pane view for a completed bridge skill load. */
export function skillInspectorFromBlock(block: ToolCallBlock): SkillInspector | null {
  if (block.tool !== "skill" || !block.skillName || !block.skillPath) return null;
  return {
    variant: "skill",
    name: block.skillName,
    path: block.skillPath,
    source: block.skillSource ?? "unknown",
    content: block.output ?? "",
    startedAt: block.startedAt,
    endedAt: block.endedAt,
  };
}
