function parseCandidate(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return null;
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
    (value.kind === "search" || value.kind === "fetch") &&
    typeof value.answer === "string" &&
    Array.isArray(value.sources)
  ) return value;
  if (typeof value.text === "string") return parseCandidate(value.text, depth + 1);
  return null;
}

export function researchResultFromResult(result) {
  if (!result || typeof result !== "object") return null;
  return parseCandidate(result.structured_content)
    ?? parseCandidate(result.structuredContent)
    ?? parseCandidate(result.content);
}
