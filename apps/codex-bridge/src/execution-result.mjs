function parseCandidate(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
    try {
      return parseCandidate(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseCandidate(item, depth + 1);
      if (parsed) return parsed;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (
    typeof value.id === "string" &&
    value.id.startsWith("job_") &&
    (value.tool === "Bash" || value.tool === "ExecuteCode") &&
    typeof value.output === "string"
  ) {
    return value;
  }
  if (typeof value.text === "string") return parseCandidate(value.text, depth + 1);
  return null;
}

/** Normalize MCP SDK result shapes without exposing the internal execution job envelope. */
export function executionJobFromResult(result) {
  if (!result || typeof result !== "object") return null;
  return parseCandidate(result.structured_content)
    ?? parseCandidate(result.structuredContent)
    ?? parseCandidate(result.content);
}
