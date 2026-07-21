#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`missing ${name}`);
  }
  return resolve(process.argv[index + 1]);
}

const root = resolve(import.meta.dirname, "../..");
const output = option("--out");
const server = option("--server");
const bridge = option("--bridge");
const windows = process.platform === "win32";

const required = [
  server,
  bridge,
  join(root, "apps/desktop/dist"),
  join(root, "runtime/skills/external/ai4s-skills"),
  join(root, "runtime/skills/external/anthropic-skills"),
  join(root, "runtime/skills/core"),
  join(root, "runtime/harness"),
  join(root, "examples/climate-trends"),
];
for (const path of required) {
  if (!existsSync(path)) throw new Error(`required release input is missing: ${path}`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const serverName = windows ? "apexdiscovery-server.exe" : "apexdiscovery-server";
const nodeName = windows ? "node.exe" : "node";
copyFileSync(server, join(output, serverName));
copyFileSync(join(root, "LICENSE"), join(output, "LICENSE"));
const runtime = join(output, "runtime");
const runtimeBin = windows ? runtime : join(runtime, "bin");
mkdirSync(runtimeBin, { recursive: true });
copyFileSync(process.execPath, join(runtimeBin, nodeName));
const nodeHome = windows ? dirname(process.execPath) : dirname(dirname(process.execPath));
let copiedNodeLicense = false;
for (const name of ["LICENSE", "LICENSE.txt"]) {
  const license = join(nodeHome, name);
  if (existsSync(license)) {
    copyFileSync(license, join(runtime, "LICENSE-node.txt"));
    copiedNodeLicense = true;
    break;
  }
}
if (!copiedNodeLicense) throw new Error(`Node license not found under ${nodeHome}`);

// Official Node archives are normally self-contained. Homebrew and some Linux
// packages link the executable to a sibling libnode, so include that library
// using the same bin/../lib layout to keep locally assembled bundles portable.
if (!windows && basename(dirname(process.execPath)) === "bin") {
  const sourceLib = join(nodeHome, "lib");
  if (existsSync(sourceLib)) {
    const targetLib = join(runtime, "lib");
    for (const name of readdirSync(sourceLib).filter((name) => name.startsWith("libnode."))) {
      mkdirSync(targetLib, { recursive: true });
      copyFileSync(join(sourceLib, name), join(targetLib, name));
    }
  }
} else if (windows) {
  for (const name of readdirSync(dirname(process.execPath)).filter((name) => name.endsWith(".dll"))) {
    copyFileSync(join(dirname(process.execPath), name), join(runtime, name));
  }
}
cpSync(bridge, join(output, "codex-bridge"), { recursive: true });
cpSync(join(root, "apps/desktop/dist"), join(output, "dist"), { recursive: true });

const resources = join(output, "resources");
mkdirSync(join(resources, "examples"), { recursive: true });
cpSync(join(root, "runtime/skills/external/ai4s-skills"), join(resources, "skills"), {
  recursive: true,
});
cpSync(
  join(root, "runtime/skills/external/anthropic-skills"),
  join(resources, "skills-office"),
  { recursive: true },
);
cpSync(join(root, "runtime/skills/core"), join(resources, "skills-core"), {
  recursive: true,
});
cpSync(join(root, "runtime/harness"), join(resources, "harness"), { recursive: true });
cpSync(join(root, "examples/climate-trends"), join(resources, "examples/climate-trends"), {
  recursive: true,
});

writeFileSync(
  join(output, "README.txt"),
  [
    "APEX Discovery — local browser edition",
    "",
    windows
      ? "Double-click APEX Discovery.cmd."
      : "Double-click APEX Discovery.command on macOS, or run ./apexdiscovery in a terminal.",
    windows
      ? "The bundle is unsigned, so Windows may show a SmartScreen warning."
      : "If macOS quarantines the unsigned bundle, run: xattr -cr apexdiscovery-browser",
    "The launcher opens your normal browser. There is no APEX account or sign-in.",
    "Set OPENAI_API_KEY before launching, or enter the key in Settings for the current run.",
    "Keep this process running while you use APEX Discovery; stop it with Ctrl+C.",
    "Only use --host 0.0.0.0 behind TLS with an explicit APEX_TOKEN.",
    "",
  ].join(windows ? "\r\n" : "\n"),
);

if (windows) {
  writeFileSync(
    join(output, "APEX Discovery.cmd"),
    [
      "@echo off",
      "setlocal",
      "set \"ROOT=%~dp0\"",
      "set \"APEX_NODE_BIN=%ROOT%runtime\\node.exe\"",
      "set \"APEX_OPENCODE_BIN=%ROOT%codex-bridge\\src\\server.mjs\"",
      "set \"APEX_FRONTEND_DIR=%ROOT%dist\"",
      "set \"APEX_RESOURCE_DIR=%ROOT%resources\"",
      "\"%ROOT%apexdiscovery-server.exe\" %*",
      "endlocal",
      "",
    ].join("\r\n"),
  );
} else {
  const launcher = [
    "#!/bin/sh",
    "set -eu",
    'ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'export APEX_NODE_BIN="$ROOT/runtime/bin/node"',
    'export APEX_OPENCODE_BIN="$ROOT/codex-bridge/src/server.mjs"',
    'export APEX_FRONTEND_DIR="$ROOT/dist"',
    'export APEX_RESOURCE_DIR="$ROOT/resources"',
    'exec "$ROOT/apexdiscovery-server" "$@"',
    "",
  ].join("\n");
  writeFileSync(join(output, "apexdiscovery"), launcher);
  writeFileSync(join(output, "APEX Discovery.command"), launcher);
  for (const path of [
    join(output, serverName),
    join(runtimeBin, nodeName),
    join(output, "apexdiscovery"),
    join(output, "APEX Discovery.command"),
  ]) {
    chmodSync(path, 0o755);
  }
}

console.log(`browser release assembled at ${output}`);
console.log(`server: ${basename(server)}; node: ${process.version} ${process.arch}`);
