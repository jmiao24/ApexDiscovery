#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { query } from "@anthropic-ai/claude-agent-sdk";

const DEFAULT_BASE_URL = "https://openrouter.ai/api";
const DEFAULT_MODEL = "openai/gpt-5.4-mini";

function usage() {
  console.log(`Usage: pnpm --filter @ai4s/claude-bridge test:gpt -- [options]

Runs a real Claude Agent SDK turn through an Anthropic-compatible gateway and
requires the selected GPT model to call the SDK's built-in Read tool.

Options:
  --model <id>       Gateway model ID (default: ${DEFAULT_MODEL})
  --base-url <url>   Anthropic-compatible endpoint (default: ${DEFAULT_BASE_URL})
  --verbose          Print every SDK message as JSON
  --help             Show this help

Authentication:
  OpenRouter: set OPENROUTER_API_KEY.
  Other gateways: set ANTHROPIC_AUTH_TOKEN. A localhost gateway may inject its
  own upstream key, so this script supplies a non-secret placeholder if needed.

Examples:
  OPENROUTER_API_KEY=... pnpm --filter @ai4s/claude-bridge test:gpt
  ANTHROPIC_AUTH_TOKEN=... pnpm --filter @ai4s/claude-bridge test:gpt -- \\
    --base-url http://127.0.0.1:3456 --model gpt-5.4-mini
`);
}

function parseArgs(argv) {
  const values = {
    baseUrl: process.env.GPT_AGENT_BASE_URL || DEFAULT_BASE_URL,
    model: process.env.GPT_AGENT_MODEL || DEFAULT_MODEL,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // pnpm may preserve the conventional option separator for recursive runs.
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") return { ...values, help: true };
    if (arg === "--verbose") {
      values.verbose = true;
      continue;
    }
    if (arg === "--model" || arg === "--base-url") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      values[arg === "--model" ? "model" : "baseUrl"] = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return values;
}

function isLoopback(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function resolveAuth(baseUrl) {
  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    return { source: "ANTHROPIC_AUTH_TOKEN", token: process.env.ANTHROPIC_AUTH_TOKEN };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { source: "OPENROUTER_API_KEY", token: process.env.OPENROUTER_API_KEY };
  }
  if (isLoopback(baseUrl)) {
    return { source: "local gateway placeholder", token: "local-gateway" };
  }
  throw new Error(
    "Missing credentials. Set OPENROUTER_API_KEY, or ANTHROPIC_AUTH_TOKEN for a custom gateway.",
  );
}

function textBlocks(message) {
  if (message.type !== "assistant" || !Array.isArray(message.message?.content)) return [];
  return message.message.content.filter((block) => block?.type === "text").map((block) => block.text);
}

function toolBlocks(message) {
  if (message.type !== "assistant" || !Array.isArray(message.message?.content)) return [];
  return message.message.content.filter((block) => block?.type === "tool_use");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Configuration error: ${error.message}`);
    usage();
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    usage();
    return;
  }

  let auth;
  try {
    auth = resolveAuth(options.baseUrl);
  } catch (error) {
    console.error(`Configuration error: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), "claude-agent-gpt-probe-"));
  const nonce = `probe-${randomUUID()}`;
  await writeFile(join(workDir, "probe.txt"), `${nonce}\n`, "utf8");

  const childEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: options.baseUrl,
    ANTHROPIC_AUTH_TOKEN: auth.token,
    // Claude Code otherwise may prefer a cached Anthropic credential.
    ANTHROPIC_API_KEY: "",
    // Cover helper and subagent requests that use model tiers instead of the
    // explicit query model. This probe itself does not enable subagents.
    ANTHROPIC_DEFAULT_OPUS_MODEL: options.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: options.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: options.model,
    CLAUDE_CODE_SUBAGENT_MODEL: options.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };

  console.log(`Gateway: ${options.baseUrl}`);
  console.log(`Requested model: ${options.model}`);
  console.log(`Authentication: ${auth.source}`);
  console.log("Probe: require one built-in Read tool call and verify unknown file content");

  let sawRead = false;
  let finalText = "";
  let resultMessage;

  try {
    const messages = query({
      prompt:
        "Use the Read tool to read probe.txt. Then reply with exactly " +
        "SDK_GPT_TOOL_OK:<the file content>, with no other text. You do not know " +
        "the file content until you call Read.",
      options: {
        cwd: workDir,
        env: childEnv,
        model: options.model,
        maxTurns: 3,
        permissionMode: "dontAsk",
        settingSources: [],
        tools: ["Read"],
        allowedTools: ["Read"],
      },
    });

    for await (const message of messages) {
      if (options.verbose) console.log(JSON.stringify(message));
      for (const block of toolBlocks(message)) {
        if (block.name === "Read") sawRead = true;
      }
      finalText += textBlocks(message).join("");
      if (message.type === "result") resultMessage = message;
    }
  } catch (error) {
    console.error(`FAIL: SDK or gateway threw: ${error.stack || error.message}`);
    process.exitCode = 1;
    return;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const modelUsage = Object.keys(resultMessage?.modelUsage || {});
  const usedGpt = modelUsage.some((model) => /(^|\/)gpt-/i.test(model));
  const returnedNonce = `${finalText}\n${resultMessage?.result || ""}`.includes(nonce);
  const completed = resultMessage?.subtype === "success" && !resultMessage.is_error;

  console.log(`Read tool observed: ${sawRead ? "yes" : "no"}`);
  console.log(`Unknown file content returned: ${returnedNonce ? "yes" : "no"}`);
  console.log(`Models reported by SDK: ${modelUsage.join(", ") || "none"}`);
  console.log(`Successful SDK result: ${completed ? "yes" : "no"}`);

  if (sawRead && returnedNonce && usedGpt && completed) {
    console.log("PASS: a GPT model completed a Claude Agent SDK tool-use loop.");
    return;
  }

  if (resultMessage?.errors?.length) {
    console.error(`Gateway errors: ${resultMessage.errors.join(" | ")}`);
  }
  console.error(
    "FAIL: the response did not prove all four conditions (Read call, unknown content, GPT usage, success).",
  );
  process.exitCode = 1;
}

await main();
