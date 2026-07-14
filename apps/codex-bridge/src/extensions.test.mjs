import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  discoverSkills,
  effectiveMcpServers,
  invokedSkills,
  loadedSkillContext,
  pluginSkillContext,
  toCodexMcpServers,
} from "./extensions.mjs";

function write(path, text) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

test("discovers Codex project, user, and enabled plugin skills", () => {
  const root = mkdtempSync(join(tmpdir(), "apex-ext-"));
  try {
    const project = join(root, "repo", "nested");
    const home = join(root, "home");
    const extensions = join(root, "extensions");
    const plugin = join(extensions, "plugins", "papers");
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    mkdirSync(project, { recursive: true });
    write(join(root, "repo", ".agents", "skills", "repo-skill", "SKILL.md"), "---\nname: repo-skill\ndescription: Repository workflow\n---\n");
    write(join(home, ".agents", "skills", "user-skill", "SKILL.md"), "---\nname: user-skill\ndescription: User workflow\n---\n");
    write(join(plugin, ".codex-plugin", "plugin.json"), JSON.stringify({ skills: "./skills" }));
    write(join(plugin, "skills", "paper", "SKILL.md"), "---\nname: paper\ndescription: Search papers\n---\n");
    write(join(extensions, "index.json"), JSON.stringify({ plugins: [{ name: "papers", path: plugin, enabled: true }] }));

    const skills = discoverSkills({ directory: project, home, extensionsDir: extensions, adminSkillRoot: null });
    assert.deepEqual(skills.map((skill) => skill.name).sort(), ["paper", "repo-skill", "user-skill"]);
    assert.match(pluginSkillContext(skills), /\$paper: Search papers/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolves explicit skill invocations with project precedence and builds full context", () => {
  const skills = [
    { name: "open-targets", source: "user", location: "/home/.agents/skills/open-targets/SKILL.md" },
    { name: "open-targets", source: "project", location: "/repo/.agents/skills/open-targets/SKILL.md" },
    { name: "paper", source: "plugin", location: "/plugins/paper/SKILL.md" },
  ];
  const invoked = invokedSkills("$open-targets compare MC4R with $paper and $open-targets", skills);
  assert.deepEqual(invoked.map((skill) => skill.location), [
    "/repo/.agents/skills/open-targets/SKILL.md",
    "/plugins/paper/SKILL.md",
  ]);
  const context = loadedSkillContext([{ skill: invoked[0], content: "# Open Targets\nUse GraphQL." }]);
  assert.match(context, /<apex_loaded_skills>/);
  assert.match(context, /# Open Targets\nUse GraphQL\./);
});

test("resolves structured skill selections without leaking invocation syntax into the prompt", () => {
  const skills = [
    { name: "open-targets", source: "user", location: "/skills/open-targets/SKILL.md" },
    { name: "paperclip", source: "user", location: "/skills/paperclip/SKILL.md" },
  ];
  const invoked = invokedSkills(
    "Find the strongest MC4R opportunities",
    skills,
    ["paperclip", "../invalid", "open-targets", "paperclip"],
  );
  assert.deepEqual(invoked.map((skill) => skill.name), ["paperclip", "open-targets"]);
});

test("merges plugin MCP servers and converts secret references for Codex", () => {
  const root = mkdtempSync(join(tmpdir(), "apex-mcp-"));
  try {
    const extensions = join(root, "extensions");
    const plugin = join(extensions, "plugins", "papers");
    write(join(plugin, ".codex-plugin", "plugin.json"), JSON.stringify({ mcpServers: "./.mcp.json" }));
    write(join(plugin, ".mcp.json"), JSON.stringify({ mcpServers: { search: { command: "./bin/server", args: ["--stdio"], env: { TOKEN: "$env:PAPER_TOKEN" } } } }));
    write(join(extensions, "index.json"), JSON.stringify({ plugins: [{ name: "papers", path: plugin, enabled: true }] }));

    const effective = effectiveMcpServers({ docs: { type: "remote", url: "https://example.test/mcp" } }, extensions);
    assert.equal(effective.papers__search.command[0], join(plugin, "bin", "server"));
    assert.equal(effective.papers__search.managedBy, "papers");
    const codex = toCodexMcpServers(effective, { PAPER_TOKEN: "secret" });
    assert.equal(codex.papers__search.env.TOKEN, "secret");
    assert.equal(codex.papers__search.default_tools_approval_mode, "writes");
    assert.equal(codex.docs.url, "https://example.test/mcp");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
