import assert from "node:assert/strict";
import test from "node:test";
import { commandExecutionDescription, commandExecutionMetadata } from "./command-description.mjs";

test("labels the initial workspace inspection", () => {
  assert.equal(
    commandExecutionDescription(
      "/bin/zsh -lc \"pwd && sed -n '1,240p' AGENTS.md && git status --short && find . -maxdepth 2 -type f\"",
    ),
    "Inspecting workspace context",
  );
});

test("labels common native command categories", () => {
  assert.equal(commandExecutionDescription("git status --short"), "Inspecting repository state");
  assert.equal(commandExecutionDescription("rg -n human_description apps"), "Searching workspace files");
  assert.equal(commandExecutionDescription("pnpm test"), "Running project tests");
  assert.equal(commandExecutionDescription("python3 -m pip install pandas"), "Installing project dependencies");
  assert.equal(commandExecutionDescription("paperclip search -s pmc PCSK9"), "Querying Paperclip literature");
});

test("uses a truthful fallback for unclassified commands", () => {
  assert.equal(commandExecutionDescription("pwd"), "Running workspace shell command");
});

test("enriches native command events with explicit bridge metadata", () => {
  assert.deepEqual(commandExecutionMetadata("git status --short", "main"), {
    title: "Inspecting repository state",
    input: {
      command: "git status --short",
      phase: "main",
      human_description: "Inspecting repository state",
      description_source: "bridge",
    },
  });
});
