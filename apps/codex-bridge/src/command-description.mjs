const includesAny = (value, patterns) => patterns.some((pattern) => pattern.test(value));

/**
 * Codex SDK command_execution items do not carry model-authored metadata.
 * Supply a short, deterministic activity label so the APEX event contract stays
 * human-readable without exposing the full shell command as the title.
 */
export function commandExecutionDescription(command) {
  const normalized = String(command ?? "").replace(/\s+/g, " ").trim().toLowerCase();

  if (/agents\.md|knowledge\.md/.test(normalized) && /git status|find |rg --files/.test(normalized)) {
    return "Inspecting workspace context";
  }
  if (/\bgit\s+clone\b/.test(normalized)) return "Cloning source repository";
  if (/\bgit\s+(?:status|diff|log|show)\b/.test(normalized)) return "Inspecting repository state";
  if (includesAny(normalized, [/\b(?:rg|grep)\b/, /\bfind\s+/, /\brg\s+--files\b/])) {
    return "Searching workspace files";
  }
  if (includesAny(normalized, [/\b(?:pnpm|npm|yarn|bun)\s+(?:test|run test)\b/, /\bpytest\b/, /\bcargo\s+test\b/, /\bgo\s+test\b/])) {
    return "Running project tests";
  }
  if (includesAny(normalized, [/\b(?:pnpm|npm|yarn|bun)\s+(?:install|add)\b/, /\bpip(?:3)?\s+install\b/, /\bcargo\s+add\b/])) {
    return "Installing project dependencies";
  }
  if (includesAny(normalized, [/\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b/, /\bcargo\s+build\b/])) {
    return "Building project artifacts";
  }
  if (/\bpaperclip\b/.test(normalized)) return "Querying Paperclip literature";
  return "Running workspace shell command";
}

export function commandExecutionMetadata(command, phase) {
  const humanDescription = commandExecutionDescription(command);
  return {
    title: humanDescription,
    input: {
      command,
      phase,
      human_description: humanDescription,
      description_source: "bridge",
    },
  };
}
