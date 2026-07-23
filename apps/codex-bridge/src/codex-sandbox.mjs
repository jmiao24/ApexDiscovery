import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM_PACKAGE = {
  "linux:x64": ["@openai/codex-linux-x64", "x86_64-unknown-linux-musl"],
  "linux:arm64": ["@openai/codex-linux-arm64", "aarch64-unknown-linux-musl"],
  "darwin:x64": ["@openai/codex-darwin-x64", "x86_64-apple-darwin"],
  "darwin:arm64": ["@openai/codex-darwin-arm64", "aarch64-apple-darwin"],
  "win32:x64": ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc"],
  "win32:arm64": ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc"],
};

export function resolveCodexExecutable({ platform = process.platform, arch = process.arch } = {}) {
  if (process.env.APEX_CODEX_EXECUTABLE) return process.env.APEX_CODEX_EXECUTABLE;
  const target = PLATFORM_PACKAGE[`${platform}:${arch}`];
  if (!target) throw new Error(`unsupported Codex sandbox platform: ${platform} (${arch})`);

  const sdkEntry = fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
  const sdkRequire = createRequire(sdkEntry);
  const codexPackage = sdkRequire.resolve("@openai/codex/package.json");
  const codexRequire = createRequire(codexPackage);
  const platformPackage = codexRequire.resolve(`${target[0]}/package.json`);
  const vendorRoot = join(dirname(platformPackage), "vendor", target[1]);
  const executableName = platform === "win32" ? "codex.exe" : "codex";
  const current = join(vendorRoot, "bin", executableName);
  const legacy = join(vendorRoot, "codex", executableName);
  if (existsSync(current)) return current;
  if (existsSync(legacy)) return legacy;
  throw new Error(`Codex sandbox executable is missing for ${target[1]}`);
}

const DOMAIN_PATTERN = /^(?:\*\*?\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeNetworkDomains(values) {
  if (!Array.isArray(values)) throw new Error("ExecuteCode allowed domains must be an array");
  if (values.length > 100) throw new Error("ExecuteCode allowed domains are limited to 100 entries");
  const normalized = [];
  for (const raw of values) {
    const domain = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
    if (!domain) continue;
    if (!DOMAIN_PATTERN.test(domain) || domain.endsWith(".localhost") || domain.endsWith(".local")) {
      throw new Error(`Invalid ExecuteCode allowed domain: ${domain}`);
    }
    if (!normalized.includes(domain)) normalized.push(domain);
  }
  return normalized;
}

export function workspaceSandboxInvocation({
  cwd,
  file,
  args = [],
  executable,
  allowedUnixSockets = [],
} = {}) {
  if (!cwd) throw new Error("sandbox cwd is required");
  if (!file) throw new Error("sandbox command is required");
  return {
    file: executable || resolveCodexExecutable(),
    args: [
      "sandbox",
      "--permission-profile",
      ":workspace",
      "--include-managed-config",
      "--cd",
      cwd,
      ...allowedUnixSockets.flatMap((path) => ["--allow-unix-socket", path]),
      "--",
      file,
      ...args,
    ],
  };
}
