#!/usr/bin/env node

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const targetIndex = process.argv.indexOf("--target");
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.argv[2];
if (!target) {
  console.error("usage: node scripts/dev/prepare-codex-runtime.mjs --target <rust-target-triple>");
  process.exit(2);
}

const binaries = join(root, "apps/desktop/src-tauri/binaries");
const runtime = join(root, ".tauri-runtime");
const bridge = join(runtime, "codex-bridge");
const suffix = target.includes("windows") ? ".exe" : "";
const nodeSidecar = join(binaries, `apex-runtime-${target}${suffix}`);

mkdirSync(binaries, { recursive: true });
rmSync(bridge, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
rmSync(nodeSidecar, { force: true });
copyFileSync(process.execPath, nodeSidecar);

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const deployed = spawnSync(
  pnpm,
  ["--filter", "@ai4s/codex-bridge", "deploy", "--prod", bridge],
  { cwd: root, stdio: "inherit" },
);
if (deployed.status !== 0) process.exit(deployed.status ?? 1);

console.log(`Prepared Codex runtime for ${target}`);
