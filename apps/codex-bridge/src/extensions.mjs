import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function unquote(value) {
  const text = value.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

export function skillMetadata(skillMd) {
  const text = readFileSync(skillMd, "utf8");
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/m.exec(text)?.[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1];
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1];
  return {
    name: name ? unquote(name) : dirname(skillMd).split(/[\\/]/).pop(),
    description: description ? unquote(description) : "",
    location: skillMd,
  };
}

function scanSkillRoot(root, source, plugin) {
  if (!root || !existsSync(root)) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const skillMd = join(root, entry.name, "SKILL.md");
    if (!existsSync(skillMd)) return [];
    try {
      return [{ ...skillMetadata(skillMd), source, ...(plugin ? { plugin } : {}) }];
    } catch {
      return [];
    }
  });
}

function projectSkillRoots(directory) {
  if (!directory) return [];
  const roots = [];
  const start = resolve(directory);
  let current = start;
  let foundRepository = false;
  while (true) {
    roots.push(join(current, ".agents", "skills"));
    if (existsSync(join(current, ".git"))) {
      foundRepository = true;
      break;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Outside a repository, never walk arbitrary parent directories looking for
  // executable workflows; only the explicitly selected workspace applies.
  return foundRepository ? roots.reverse() : [join(start, ".agents", "skills")];
}

export function readExtensionIndex(extensionsDir) {
  if (!extensionsDir) return [];
  const value = readJson(join(extensionsDir, "index.json"), { plugins: [] });
  return Array.isArray(value?.plugins) ? value.plugins : [];
}

export function discoverSkills({
  directory,
  home,
  codexHome,
  extensionsDir,
  bundledSkillRoot,
  coreSkillRoot,
  systemSkillRoot,
  additionalSkillRoots = [],
  adminSkillRoot = process.platform === "win32" ? null : "/etc/codex/skills",
  allowedSkillNames,
}) {
  const skills = [];
  for (const root of projectSkillRoots(directory)) {
    skills.push(...scanSkillRoot(root, "project"));
  }
  skills.push(...scanSkillRoot(home ? join(home, ".agents", "skills") : null, "user"));
  skills.push(...scanSkillRoot(codexHome ? join(codexHome, "skills") : null, "user"));
  skills.push(...scanSkillRoot(adminSkillRoot, "admin"));
  skills.push(...scanSkillRoot(bundledSkillRoot, "builtin"));
  skills.push(...scanSkillRoot(coreSkillRoot, "builtin"));
  skills.push(...scanSkillRoot(systemSkillRoot, "builtin"));
  for (const root of additionalSkillRoots) {
    skills.push(...scanSkillRoot(root, "builtin"));
  }

  for (const plugin of readExtensionIndex(extensionsDir)) {
    if (!plugin?.enabled || typeof plugin.path !== "string") continue;
    const manifest = readJson(join(plugin.path, ".codex-plugin", "plugin.json"), {});
    const relativeSkills = typeof manifest.skills === "string" ? manifest.skills : "./skills";
    skills.push(
      ...scanSkillRoot(resolve(plugin.path, relativeSkills), "plugin", plugin.name),
    );
  }

  // Preserve scopes with duplicate names while avoiding the same file twice.
  const seen = new Set();
  const allowed = Array.isArray(allowedSkillNames) ? new Set(allowedSkillNames) : null;
  return skills.filter((skill) => {
    if (allowed && !allowed.has(skill.name)) return false;
    const key = resolve(skill.location);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolvePluginCommand(root, command) {
  if (!root || typeof command !== "string") return command;
  if (command.startsWith("./") || command.startsWith("../")) return resolve(root, command);
  return command;
}

export function normalizeMcpConfig(value, root) {
  if (!value || typeof value !== "object") return null;
  if (value.type === "local" && Array.isArray(value.command) && value.command.length) {
    return {
      type: "local",
      command: [resolvePluginCommand(root, value.command[0]), ...value.command.slice(1)],
      enabled: value.enabled !== false,
      ...(value.environment && typeof value.environment === "object"
        ? { environment: value.environment }
        : {}),
      ...(typeof value.approvalMode === "string" ? { approvalMode: value.approvalMode } : {}),
      ...(Array.isArray(value.enabledTools) ? { enabledTools: value.enabledTools } : {}),
      ...(Array.isArray(value.disabledTools) ? { disabledTools: value.disabledTools } : {}),
    };
  }
  if (typeof value.command === "string") {
    return normalizeMcpConfig(
      {
        type: "local",
        command: [value.command, ...(Array.isArray(value.args) ? value.args : [])],
        enabled: value.enabled,
        environment: value.env,
        approvalMode: value.default_tools_approval_mode,
        enabledTools: value.enabled_tools,
        disabledTools: value.disabled_tools,
      },
      root,
    );
  }
  if ((value.type === "remote" || typeof value.url === "string") && typeof value.url === "string") {
    return {
      type: "remote",
      url: value.url,
      enabled: value.enabled !== false,
      ...(value.headers && typeof value.headers === "object" ? { headers: value.headers } : {}),
      ...(typeof value.approvalMode === "string" ? { approvalMode: value.approvalMode } : {}),
      ...(Array.isArray(value.enabledTools) ? { enabledTools: value.enabledTools } : {}),
      ...(Array.isArray(value.disabledTools) ? { disabledTools: value.disabledTools } : {}),
    };
  }
  return null;
}

function pluginMcpServers(plugin) {
  const manifest = readJson(join(plugin.path, ".codex-plugin", "plugin.json"), {});
  if (typeof manifest.mcpServers !== "string") return {};
  const raw = readJson(resolve(plugin.path, manifest.mcpServers), {});
  const servers = raw.mcpServers ?? raw.mcp_servers ?? raw;
  return servers && typeof servers === "object" && !Array.isArray(servers) ? servers : {};
}

export function effectiveMcpServers(userServers = {}, extensionsDir) {
  const result = {};
  for (const [name, value] of Object.entries(userServers ?? {})) {
    const normalized = normalizeMcpConfig(value);
    if (normalized) result[name] = normalized;
  }
  for (const plugin of readExtensionIndex(extensionsDir)) {
    if (!plugin?.enabled || typeof plugin.path !== "string" || typeof plugin.name !== "string") continue;
    for (const [name, value] of Object.entries(pluginMcpServers(plugin))) {
      const normalized = normalizeMcpConfig(value, plugin.path);
      if (normalized) result[`${plugin.name}__${name}`] = { ...normalized, managedBy: plugin.name };
    }
  }
  return result;
}

function resolveSecret(value, env) {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("$env:")) return env[value.slice(5)];
  // Plugin configuration may use ${NAME}; values remain outside the manifest.
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  if (match) return env[match[1]];
  return value;
}

export function toCodexMcpServers(servers, env = process.env) {
  const result = {};
  for (const [name, server] of Object.entries(servers ?? {})) {
    if (!server || server.enabled === false) continue;
    const common = {
      enabled: true,
      // Unknown third-party tools are conservative by default: Codex prompts
      // for tools not declared read-only. A plugin can opt into a stricter
      // policy, but never silently broadens this default.
      default_tools_approval_mode: server.approvalMode ?? "writes",
      ...(server.enabledTools ? { enabled_tools: server.enabledTools } : {}),
      ...(server.disabledTools ? { disabled_tools: server.disabledTools } : {}),
    };
    if (server.type === "local" && Array.isArray(server.command) && server.command.length) {
      const resolvedEnv = Object.fromEntries(
        Object.entries(server.environment ?? {})
          .map(([key, value]) => [key, resolveSecret(value, env)])
          .filter(([, value]) => typeof value === "string"),
      );
      result[name] = {
        command: server.command[0],
        args: server.command.slice(1),
        ...(Object.keys(resolvedEnv).length ? { env: resolvedEnv } : {}),
        ...common,
      };
    } else if (server.type === "remote" && typeof server.url === "string") {
      const headers = Object.fromEntries(
        Object.entries(server.headers ?? {})
          .map(([key, value]) => [key, resolveSecret(value, env)])
          .filter(([, value]) => typeof value === "string"),
      );
      result[name] = {
        url: server.url,
        ...(Object.keys(headers).length ? { http_headers: headers } : {}),
        ...common,
      };
    }
  }
  return result;
}

export function skillCatalogContext(skills) {
  const scopes = ["project", "user", "admin", "plugin", "builtin"];
  const names = [...new Set(skills.map((skill) => skill.name))].sort();
  const catalog = names.flatMap((name) => {
    const matches = skills.filter((skill) => skill.name === name);
    for (const source of scopes) {
      const scoped = matches.filter((skill) => skill.source === source);
      if (scoped.length) return [scoped.at(-1)];
    }
    return [];
  });
  if (!catalog.length) return "";
  const lines = catalog.map(
    (skill) => `- $${skill.name}: ${skill.description || "No description"} [${skill.source}] (${skill.location})`,
  );
  return [
    "<apex_skill_catalog>",
    "APEX discovered these installed and workspace skills. This catalog contains metadata only. When the user explicitly names one, or the request clearly matches its description, read its SKILL.md completely before acting and follow it. Resolve relative files from the skill directory.",
    ...lines,
    "</apex_skill_catalog>",
  ].join("\n");
}

/**
 * Resolve structured picker selections and explicit `$skill-name` references
 * to one installed skill each.
 * Project skills win (the nearest project root is last in discovery order),
 * followed by user, admin, plugin, and builtin scopes.  Reading is deliberately
 * kept separate so callers can emit an auditable started/completed event.
 */
export function invokedSkills(prompt, skills, selectedNames = []) {
  const names = [];
  const seen = new Set();
  for (const value of selectedNames) {
    const name = String(value ?? "");
    if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  for (const match of String(prompt ?? "").matchAll(/\$([A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      names.push(match[1]);
    }
  }

  const scopes = ["project", "user", "admin", "plugin", "builtin"];
  return names.flatMap((name) => {
    const matches = skills.filter((skill) => skill.name === name);
    for (const source of scopes) {
      const scoped = matches.filter((skill) => skill.source === source);
      if (scoped.length) return [scoped.at(-1)];
    }
    return [];
  });
}

/** Full, already-read skill instructions passed to Codex after the load event. */
export function loadedSkillContext(loaded) {
  if (!loaded.length) return "";
  return [
    "<apex_loaded_skills>",
    "APEX has fully loaded these explicitly invoked skills. Follow their instructions for this turn; resolve relative paths from each listed directory.",
    ...loaded.flatMap(({ skill, content }) => [
      `<skill name=${JSON.stringify(skill.name)} source=${JSON.stringify(skill.source)} path=${JSON.stringify(skill.location)}>`,
      content,
      "</skill>",
    ]),
    "</apex_loaded_skills>",
  ].join("\n");
}

export function pluginReadRoots(extensionsDir) {
  return readExtensionIndex(extensionsDir)
    .filter((plugin) => plugin?.enabled && typeof plugin.path === "string")
    .map((plugin) => plugin.path)
    .filter((path) => {
      try {
        return isAbsolute(path) && statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
}
