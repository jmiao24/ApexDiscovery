#!/usr/bin/env node
// codex-bridge: an OpenCode-compatible HTTP+SSE server whose agent is the
// OpenAI Codex SDK. It speaks the same wire subset as claude-bridge (see
// packages/sdk's OpenCodeClient for the consumer) and accepts the same CLI/env
// contract as `opencode serve` — so the desktop shell and apexscience-server
// can spawn it as a drop-in sidecar and the React app runs unchanged.
//
// Codex-specific notes:
// - Approvals: Codex has no interactive per-tool approval callback; it uses OS
//   sandboxing instead. The app's approve/full switch maps to sandboxMode:
//   approve → "workspace-write" (writes confined to the workspace), full →
//   "danger-full-access". permission.asked events never fire on this backend.
// - Plan mode: the `agent` field on prompt_async is ignored (no plan routing).
// - Auth: uses OPENAI_API_KEY from the parent process or an in-memory value
//   supplied through Settings. The SDK vendors its own Codex binary.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import {
  discoverSkills,
  effectiveMcpServers,
  invokedSkills,
  loadedSkillContext,
  pluginReadRoots,
  pluginSkillContext,
  toCodexMcpServers,
} from "./extensions.mjs";
import {
  actionableFindings,
  fixPrompt,
  parseReview,
  recentReviewableFiles,
  reviewFence,
  reviewerPrompt,
  reviewerSkillNames,
  reviewTargets,
} from "./reviewer.mjs";
import {
  literatureAgentPrompt,
  literatureSubagentTask,
  literatureSynthesisPrompt,
} from "./subagents.mjs";

// ---- CLI / env contract (identical to `opencode serve`) ----
const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const HOSTNAME = argValue("--hostname", "127.0.0.1");
const PORT = Number(argValue("--port", "4096"));
const PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || "";
const AUTH_TOKEN = PASSWORD ? Buffer.from(`opencode:${PASSWORD}`).toString("base64") : null;

const DATA_HOME = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
const CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const CODEX_HOME = process.env.CODEX_HOME || join(CONFIG_HOME, "codex");
const EXTENSIONS_DIR = process.env.APEX_EXTENSIONS_DIR || "";
const BUNDLED_SKILLS_DIR = join(CONFIG_HOME, "opencode", "skills");
const STORE_DIR = join(DATA_HOME, "codex-bridge");
const HISTORY_DIR = join(STORE_DIR, "history");
process.env.CODEX_HOME = CODEX_HOME;
mkdirSync(CODEX_HOME, { recursive: true });
mkdirSync(HISTORY_DIR, { recursive: true });

// The app-private CODEX_HOME config is the source of truth for the default
// model. The bridge only overrides it when the user picks one in Settings.
function codexDefaultModel() {
  try {
    const toml = readFileSync(join(CODEX_HOME, "config.toml"), "utf8");
    return /^model\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
  } catch {
    return null;
  }
}
function modelCatalog() {
  const models = { default: { name: "Codex default (config.toml)" } };
  const configured = codexDefaultModel();
  if (configured) models[configured] = { name: configured };
  return models;
}

// ---- tiny JSON stores (single-user local bridge) ----
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

const configPath = join(STORE_DIR, "config.json");
const bridgeConfig = readJson(configPath, { model: "openai/default", mcp: {} });
// v0.1.9 briefly persisted provider keys here. Remove that legacy value on
// first boot; API credentials are process memory / parent-provided env only.
if ("apiKey" in bridgeConfig) delete bridgeConfig.apiKey;
if (!bridgeConfig.mcp || typeof bridgeConfig.mcp !== "object") bridgeConfig.mcp = {};
if (!bridgeConfig.reviewer || typeof bridgeConfig.reviewer !== "object") {
  bridgeConfig.reviewer = { enabled: false, autoFix: true, maxPasses: 2 };
}
// Review is user-triggered from the task composer. Keep the legacy field for
// wire compatibility, but never turn artifact review into a background action.
bridgeConfig.reviewer.enabled = false;
const saveConfig = () => writeJson(configPath, bridgeConfig);
saveConfig();

let runtimeApiKey = process.env.OPENAI_API_KEY || null;
const mcpStatuses = new Map();

function mcpServers() {
  return effectiveMcpServers(bridgeConfig.mcp, EXTENSIONS_DIR);
}

function codexClient() {
  return new Codex({
    ...(runtimeApiKey ? { apiKey: runtimeApiKey } : {}),
    config: { mcp_servers: toCodexMcpServers(mcpServers(), process.env) },
  });
}

// Reviewer threads deliberately receive no MCP servers. A filesystem
// read-only sandbox prevents local mutation; removing MCPs also prevents a
// reviewer from accidentally invoking an externally mutating connector.
// Network remains available per-thread for read-only citation verification.
function reviewerCodexClient() {
  return new Codex({
    ...(runtimeApiKey ? { apiKey: runtimeApiKey } : {}),
    config: { mcp_servers: {} },
  });
}

function skillsFor(directory) {
  return discoverSkills({
    directory,
    home: homedir(),
    extensionsDir: EXTENSIONS_DIR,
    bundledSkillRoot: BUNDLED_SKILLS_DIR,
  });
}

function protectMcpSecrets(name, config) {
  if (!config || typeof config !== "object") return config;
  const copy = structuredClone(config);
  for (const field of ["environment", "headers"]) {
    if (!copy[field] || typeof copy[field] !== "object") continue;
    for (const [key, value] of Object.entries(copy[field])) {
      if (typeof value !== "string" || value.startsWith("$env:") || /^\$\{.+\}$/.test(value))
        continue;
      const envName = `APEX_MCP_${name}_${key}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      process.env[envName] = value;
      copy[field][key] = `$env:${envName}`;
    }
  }
  return copy;
}

const sessionsPath = join(STORE_DIR, "sessions.json");
/** id → { id, title, directory, codexThreadId, createdAt } */
const sessions = new Map(Object.entries(readJson(sessionsPath, {})));
const saveSessions = () => writeJson(sessionsPath, Object.fromEntries(sessions));

const historyPath = (id) => join(HISTORY_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
const readHistory = (id) => readJson(historyPath(id), []);
const appendHistory = (id, message) => {
  const all = readHistory(id);
  all.push(message);
  writeJson(historyPath(id), all);
};

// ---- SSE hub ----
const sseClients = new Set();
function broadcast(type, properties) {
  const frame = `data: ${JSON.stringify({ type, properties })}\n\n`;
  for (const res of sseClients) res.write(frame);
}
setInterval(() => {
  for (const res of sseClients) res.write(": keepalive\n\n");
}, 25_000).unref();

// ---- running turns ----
/** sessionId → { aborted: boolean, close: () => void } */
const runningTurns = new Map();
let idCounter = 0;
const freshId = (prefix) => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;
const MAX_SKILL_BYTES = 512 * 1024;

// The app's approval switch writes OpenCode's permission config; map it to
// Codex's sandbox: approve → workspace-write, full → danger-full-access.
function sandboxMode() {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const cfg = readJson(join(CONFIG_HOME, "opencode", name), null);
    if (cfg && typeof cfg === "object" && "permission" in cfg) {
      return cfg.permission && typeof cfg.permission.bash === "object"
        ? "workspace-write"
        : "danger-full-access";
    }
  }
  return "workspace-write";
}

function textOfChangeKind(kind) {
  return kind === "add" ? "write" : kind === "delete" ? "bash" : "edit";
}

// ---- the agent turn ----
function manualReviewTargets(session) {
  const root = session.directory || process.cwd();
  const remembered = (Array.isArray(session.reviewTargets) ? session.reviewTargets : [])
    .filter((path) => existsSync(isAbsolute(path) ? path : join(root, path)));
  return reviewTargets(
    remembered,
    recentReviewableFiles(root, session.createdAt ?? Date.now()),
  );
}

async function runTurn(session, promptText, { reviewOnly = false, selectedSkills = [] } = {}) {
  if (runningTurns.has(session.id)) throw Object.assign(new Error("A turn is already running"), { status: 409 });

  appendHistory(session.id, {
    info: { id: freshId("msg"), role: "user", time: { completed: Date.now() } },
    parts: [{ type: "text", text: promptText }],
  });
  if (!reviewOnly && (!session.title || session.title === "Untitled")) {
    session.title = promptText.slice(0, 60).replace(/\s+/g, " ").trim() || "Untitled";
    saveSessions();
  }

  const turn = { aborted: false, close: () => {} };
  runningTurns.set(session.id, turn);

  // Assembled as the turn progresses; flushed to history at the end.
  const assistantParts = [];
  const emitToolUpdate = (callId, tool, state, targetSessionId = session.id) => {
    broadcast("message.part.updated", {
      part: { type: "tool", sessionID: targetSessionId, callID: callId, tool, state },
    });
  };
  const emitText = (partId, text, targetSessionId = session.id) => {
    broadcast("message.part.updated", {
      part: { type: "text", id: partId, sessionID: targetSessionId, text },
    });
  };

  const beginWorkflowStep = (tool, title, input, metadata) => {
    const callId = freshId(`cll_${tool}`);
    const state = {
      status: "running",
      title,
      input,
      ...(metadata ? { metadata } : {}),
      time: { start: Date.now() },
    };
    const part = { type: "tool", tool, callID: callId, state };
    assistantParts.push(part);
    emitToolUpdate(callId, tool, state);
    return { callId, part };
  };
  const finishWorkflowStep = (step, { title, output, error = false }) => {
    const state = {
      ...step.part.state,
      status: error ? "error" : "completed",
      ...(title ? { title } : {}),
      ...(output ? { output } : {}),
      time: { start: step.part.state.time.start, end: Date.now() },
    };
    step.part.state = state;
    emitToolUpdate(step.callId, step.part.tool, state);
  };

  const loadSkills = (
    selected,
    phase,
    targetSessionId = session.id,
    targetParts = assistantParts,
  ) => {
    const loaded = [];
    for (const skill of selected) {
      const callId = freshId("cll_skill");
      const started = Date.now();
      const input = {
        action: "load",
        name: skill.name,
        source: skill.source,
        path: skill.location,
        ...(phase ? { phase } : {}),
      };
      emitToolUpdate(callId, "skill", {
        status: "running",
        title: `Loading ${skill.name} skill…`,
        input,
        time: { start: started },
      }, targetSessionId);
      let state;
      try {
        const bytes = statSync(skill.location).size;
        if (bytes > MAX_SKILL_BYTES) {
          throw new Error(`SKILL.md is ${bytes} bytes; the audited load limit is ${MAX_SKILL_BYTES} bytes`);
        }
        const content = readFileSync(skill.location, "utf8");
        loaded.push({ skill, content });
        state = {
          status: "completed",
          title: `Loaded ${skill.name} skill`,
          input,
          output: content,
          time: { start: started, end: Date.now() },
        };
      } catch (error) {
        state = {
          status: "error",
          title: `Failed to load ${skill.name} skill`,
          input,
          output: error instanceof Error ? error.message : String(error),
          time: { start: started, end: Date.now() },
        };
      }
      targetParts.push({ type: "tool", tool: "skill", callID: callId, state });
      emitToolUpdate(callId, "skill", state, targetSessionId);
    }
    return loaded;
  };

  // Structured picker selections and explicit `$skill-name` invocations are
  // loaded by the bridge before Codex acts. This makes skill use deterministic
  // and auditable without exposing internal invocation syntax in the UI.
  const discoveredSkills = skillsFor(session.directory);
  const loadedSkills = reviewOnly
    ? []
    : loadSkills(invokedSkills(promptText, discoveredSkills, selectedSkills), "main");

  // "default" (or unset) leaves the model to ~/.codex/config.toml.
  const chosen = (bridgeConfig.model ?? "").split("/").pop();
  const threadOptions = {
    workingDirectory: session.directory || process.cwd(),
    ...(chosen && chosen !== "default" ? { model: chosen } : {}),
    sandboxMode: sandboxMode(),
    // The SDK's JSONL transport cannot relay interactive approval callbacks.
    // Keep the process non-interactive and rely on the workspace sandbox plus
    // per-MCP tool approval policies (default: writes).
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    additionalDirectories: [
      ...pluginReadRoots(EXTENSIONS_DIR),
      ...(existsSync(BUNDLED_SKILLS_DIR) ? [BUNDLED_SKILLS_DIR] : []),
    ],
  };

  const skillContext = pluginSkillContext(discoveredSkills);
  const loadedContext = loadedSkillContext(loadedSkills);
  const codexPrompt = [skillContext, loadedContext, promptText].filter(Boolean).join("\n\n");

  try {
    const codex = codexClient();
    const mainThread = session.codexThreadId
      ? codex.resumeThread(session.codexThreadId, threadOptions)
      : codex.startThread(threadOptions);

    /** Stream one Main/Reviewer/Fix phase through the existing OpenCode wire. */
    const streamPhase = async ({
      thread,
      prompt,
      phase,
      recordText = true,
      surfaceErrors = true,
      onThreadStarted,
      targetSessionId = session.id,
      targetParts = assistantParts,
    }) => {
      const result = { texts: [], changedPaths: [], commands: [], failed: null };
      const itemIndex = new Map();
      const { events } = await thread.runStreamed(prompt);
      turn.close = () => void events.return?.();
      const prefix = phase.replace(/[^a-zA-Z0-9_-]/g, "_");

      for await (const event of events) {
        if (turn.aborted) break;
        if (event.type === "thread.started") {
          onThreadStarted?.(event.thread_id);
          continue;
        }
        if (event.type === "turn.failed" || event.type === "error") {
          const message = event.type === "turn.failed"
            ? event.error?.message ?? `${phase} turn failed`
            : event.message ?? `${phase} runtime error`;
          result.failed = message;
          if (surfaceErrors) {
            broadcast("session.error", { sessionID: targetSessionId, error: { data: { message } } });
          }
          continue;
        }
        if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") continue;
        const item = event.item;
        if (!item) continue;

        switch (item.type) {
          case "agent_message": {
            const partId = `prt_${prefix}_${item.id}`;
            if (recordText) emitText(partId, item.text ?? "", targetSessionId);
            if (event.type === "item.completed" && item.text) {
              result.texts.push(item.text);
              if (recordText) targetParts.push({ type: "text", text: item.text });
            }
            break;
          }
          case "command_execution": {
            const callId = `cll_${prefix}_${item.id}`;
            const running = event.type !== "item.completed";
            const state = {
              status: running ? "running" : item.status === "failed" ? "error" : "completed",
              title: item.command,
              input: { command: item.command, phase },
              output: running ? undefined : item.aggregated_output ?? "",
              time: running ? { start: Date.now() } : undefined,
            };
            if (running && !itemIndex.has(item.id)) {
              itemIndex.set(item.id, targetParts.length);
              targetParts.push({ type: "tool", tool: "bash", callID: callId, state: { ...state, time: { start: Date.now() } } });
            } else if (!running) {
              result.commands.push(item.command);
              const idx = itemIndex.get(item.id);
              const started = idx !== undefined ? targetParts[idx].state.time?.start : undefined;
              const done = { ...state, time: { start: started ?? Date.now(), end: Date.now() } };
              if (idx !== undefined) targetParts[idx].state = done;
              else targetParts.push({ type: "tool", tool: "bash", callID: callId, state: done });
              emitToolUpdate(callId, "bash", done, targetSessionId);
              break;
            }
            emitToolUpdate(callId, "bash", targetParts[itemIndex.get(item.id)]?.state ?? state, targetSessionId);
            break;
          }
          case "file_change": {
            if (event.type !== "item.completed") break;
            for (const change of item.changes ?? []) {
              result.changedPaths.push(change.path);
              const tool = textOfChangeKind(change.kind);
              const callId = `cll_${prefix}_${item.id}_${change.path}`;
              const state = {
                status: item.status === "failed" ? "error" : "completed",
                title: change.path,
                input: { filePath: change.path, phase },
                time: { start: Date.now(), end: Date.now() },
              };
              targetParts.push({ type: "tool", tool, callID: callId, state });
              emitToolUpdate(callId, tool, state, targetSessionId);
            }
            break;
          }
          case "mcp_tool_call": {
            const callId = `cll_${prefix}_${item.id}`;
            const running = event.type !== "item.completed";
            const output = item.error?.message
              ?? (item.result ? JSON.stringify(item.result.structured_content ?? item.result.content ?? "") : undefined);
            const baseInput = item.arguments && typeof item.arguments === "object" ? item.arguments : { value: item.arguments };
            const state = {
              status: running ? "running" : item.status === "failed" ? "error" : "completed",
              title: `${item.server}.${item.tool}`,
              input: { ...baseInput, phase },
              ...(running ? {} : { output: output?.slice(0, 100_000) ?? "" }),
              time: running ? { start: Date.now() } : { start: Date.now(), end: Date.now() },
            };
            if (!running) {
              mcpStatuses.set(item.server, item.status === "failed" ? "failed" : "connected");
              targetParts.push({ type: "tool", tool: "mcp", callID: callId, state });
            }
            emitToolUpdate(callId, "mcp", state, targetSessionId);
            break;
          }
          case "web_search": {
            if (event.type !== "item.completed") break;
            const callId = `cll_${prefix}_${item.id}`;
            const state = {
              status: "completed",
              title: item.query ?? "web search",
              input: { pattern: item.query, phase },
              time: { start: Date.now(), end: Date.now() },
            };
            targetParts.push({ type: "tool", tool: "websearch", callID: callId, state });
            emitToolUpdate(callId, "websearch", state, targetSessionId);
            break;
          }
          case "error": {
            result.failed = item.message ?? `${phase} agent error`;
            if (surfaceErrors) {
              broadcast("session.error", {
                sessionID: targetSessionId,
                error: { data: { message: result.failed } },
              });
            }
            break;
          }
          default:
            break;
        }
      }
      return result;
    };

    const delegatedLiteratureTask = reviewOnly ? null : literatureSubagentTask(promptText);
    if (delegatedLiteratureTask) {
      const childId = freshId("ses_literature");
      const childSession = {
        id: childId,
        title: `Literature Agent · ${delegatedLiteratureTask.slice(0, 42).replace(/\s+/g, " ")}`,
        directory: session.directory,
        parentId: session.id,
        codexThreadId: null,
        createdAt: Date.now(),
      };
      sessions.set(childId, childSession);
      saveSessions();
      appendHistory(childId, {
        info: { id: freshId("msg"), role: "user", time: { completed: Date.now() } },
        parts: [{ type: "text", text: delegatedLiteratureTask }],
      });

      const taskStep = beginWorkflowStep(
        "task",
        "Literature Agent — researching evidence",
        { agent: "literature", task: delegatedLiteratureTask, sandbox: "read-only" },
        { sessionId: childId },
      );
      const childParts = [];
      const childSelectedSkills = invokedSkills(`$paperclip ${delegatedLiteratureTask}`, discoveredSkills);
      const childSkills = loadSkills(
        childSelectedSkills,
        "literature-subagent",
        childId,
        childParts,
      );
      const childThread = reviewerCodexClient().startThread({
        ...threadOptions,
        sandboxMode: "read-only",
        networkAccessEnabled: true,
        webSearchMode: "live",
      });
      const childResult = await streamPhase({
        thread: childThread,
        prompt: literatureAgentPrompt({
          task: delegatedLiteratureTask,
          skillContext: loadedSkillContext(childSkills),
        }),
        phase: "literature-subagent",
        targetSessionId: childId,
        targetParts: childParts,
        onThreadStarted: (threadId) => {
          childSession.codexThreadId = threadId;
          saveSessions();
        },
      });
      if (childParts.length) {
        appendHistory(childId, {
          info: { id: freshId("msg"), role: "assistant", time: { completed: Date.now() } },
          parts: childParts,
        });
      }
      broadcast("session.idle", { sessionID: childId });

      const fullMemo = childResult.texts.join("\n\n").trim();
      const memo = fullMemo.length > 200_000
        ? `${fullMemo.slice(0, 200_000)}\n\n[Memo truncated by APEX at 200,000 characters.]`
        : fullMemo;
      finishWorkflowStep(taskStep, {
        title: childResult.failed
          ? "Literature Agent — research failed"
          : "Literature Agent — evidence returned",
        output: childResult.failed ?? `${memo.length} characters returned from independent thread ${childSession.codexThreadId ?? childId}`,
        error: Boolean(childResult.failed),
      });
      await streamPhase({
        thread: mainThread,
        prompt: literatureSynthesisPrompt({
          task: delegatedLiteratureTask,
          memo: memo || `The literature subagent failed: ${childResult.failed ?? "no evidence memo returned"}`,
        }),
        phase: "main-synthesis",
        onThreadStarted: (threadId) => {
          session.codexThreadId = threadId;
          saveSessions();
        },
      });
      return;
    }

    let mainResult = { changedPaths: [], failed: null };
    let targets;
    if (reviewOnly) {
      targets = manualReviewTargets(session);
    } else {
      const mainStartedAt = Date.now();
      mainResult = await streamPhase({
        thread: mainThread,
        prompt: codexPrompt,
        phase: "main",
        onThreadStarted: (threadId) => {
          session.codexThreadId = threadId;
          saveSessions();
        },
      });
      targets = reviewTargets(
        mainResult.changedPaths,
        recentReviewableFiles(session.directory || process.cwd(), mainStartedAt),
      );
      if (targets.length > 0) {
        session.reviewTargets = targets;
        saveSessions();
      }
    }

    const runReview = async (pass, currentTargets) => {
      const label = pass === 1 ? "Reviewer pass 1 — reviewing artifacts" : "Reviewer pass 2 — re-reviewing fixes";
      const step = beginWorkflowStep("reviewer", label, {
        phase: "review",
        pass,
        targets: currentTargets,
        sandbox: "read-only",
      });
      const skillNames = reviewerSkillNames(currentTargets);
      const selected = invokedSkills(skillNames.map((name) => `$${name}`).join(" "), discoveredSkills);
      const reviewerSkills = loadSkills(selected, `review-${pass}`);
      const reviewerThread = reviewerCodexClient().startThread({
        ...threadOptions,
        sandboxMode: "read-only",
        networkAccessEnabled: true,
      });
      let reviewerThreadId = null;
      const result = await streamPhase({
        thread: reviewerThread,
        prompt: reviewerPrompt({
          pass,
          targets: currentTargets,
          skillContext: loadedSkillContext(reviewerSkills),
        }),
        phase: `review-${pass}`,
        recordText: false,
        surfaceErrors: false,
        onThreadStarted: (threadId) => {
          reviewerThreadId = threadId;
          step.part.state.input.reviewerThreadId = threadId;
        },
      });
      let review = parseReview(result.texts.join("\n\n"));
      const structured = Boolean(review);
      if (!review) {
        review = {
          findings: [{
            level: "warn",
            check: "integrity",
            title: result.failed ? "Reviewer could not complete" : "Reviewer returned no structured findings",
            evidence: result.failed ?? "The independent review did not return the required ```review JSON contract.",
          }],
          note: "The review is incomplete; treat these artifacts as requiring human review.",
        };
      }
      const actionable = actionableFindings(review);
      const verdict = actionable.length === 0
        ? "passed"
        : pass === 1 && bridgeConfig.reviewer.autoFix !== false
          ? "changes requested"
          : "needs human review";
      const text = reviewFence(review, { pass, verdict });
      emitText(freshId(`prt_review_${pass}`), text);
      assistantParts.push({ type: "text", text });
      finishWorkflowStep(step, {
        title: `Reviewer pass ${pass} — ${verdict}`,
        output: `${actionable.length} actionable finding${actionable.length === 1 ? "" : "s"}; independent read-only thread${reviewerThreadId ? ` ${reviewerThreadId}` : ""}`,
        error: Boolean(result.failed),
      });
      return { review, actionable, verdict, structured };
    };

    if (reviewOnly && !turn.aborted && !mainResult.failed && targets.length > 0) {
      const first = await runReview(1, targets);
      if (!turn.aborted && first.structured && first.actionable.length > 0 && bridgeConfig.reviewer.autoFix !== false) {
        const fixStep = beginWorkflowStep("fix", "Main Agent — fixing reviewer findings", {
          phase: "fix",
          pass: 1,
          targets,
          findings: first.actionable,
        });
        const fixStartedAt = Date.now();
        const fixResult = await streamPhase({
          thread: mainThread,
          prompt: fixPrompt(first.actionable, targets),
          phase: "fix",
          onThreadStarted: (threadId) => {
            session.codexThreadId = threadId;
            saveSessions();
          },
        });
        finishWorkflowStep(fixStep, {
          title: fixResult.failed ? "Main Agent — fix failed" : "Main Agent — fixes completed",
          output: fixResult.failed ?? "Reviewer findings were returned to the original Main Agent thread.",
          error: Boolean(fixResult.failed),
        });
        targets = reviewTargets(
          [...targets, ...fixResult.changedPaths],
          recentReviewableFiles(session.directory || process.cwd(), fixStartedAt),
        );
        session.reviewTargets = targets;
        saveSessions();
        if (!turn.aborted && !fixResult.failed) await runReview(2, targets);
      }
    }
  } catch (err) {
    if (!turn.aborted) {
      broadcast("session.error", {
        sessionID: session.id,
        error: { data: { message: err instanceof Error ? err.message : String(err) } },
      });
    }
  } finally {
    runningTurns.delete(session.id);
    if (assistantParts.length) {
      appendHistory(session.id, {
        info: { id: freshId("msg"), role: "assistant", time: { completed: Date.now() } },
        parts: assistantParts,
      });
    }
    broadcast("session.idle", { sessionID: session.id });
  }
}

// ---- "!" shell mode: run a command directly, no model turn ----
function runShell(session, command) {
  const callId = freshId("cll");
  const started = Date.now();
  broadcast("message.part.updated", {
    part: {
      type: "tool",
      sessionID: session.id,
      callID: callId,
      tool: "bash",
      state: { status: "running", title: command, input: { command }, time: { start: started } },
    },
  });
  return new Promise((resolve) => {
    const shell = process.platform === "win32"
      ? { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] }
      : { file: "/bin/sh", args: ["-c", command] };
    execFile(shell.file, shell.args, { cwd: session.directory || process.cwd(), timeout: 120_000 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      const state = {
        status: err ? "error" : "completed",
        title: command,
        input: { command },
        output: output || (err ? String(err.message) : ""),
        time: { start: started, end: Date.now() },
      };
      broadcast("message.part.updated", {
        part: { type: "tool", sessionID: session.id, callID: callId, tool: "bash", state },
      });
      appendHistory(session.id, {
        info: { id: freshId("msg"), role: "assistant", time: { completed: Date.now() } },
        parts: [{ type: "tool", tool: "bash", callID: callId, state }],
      });
      broadcast("session.idle", { sessionID: session.id });
      resolve();
    });
  });
}

// ---- HTTP plumbing ----
function authorized(req, url) {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization;
  if (header === `Basic ${AUTH_TOKEN}`) return true;
  return url.searchParams.get("auth_token") === AUTH_TOKEN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
function notFound(res) {
  json(res, { message: "not found" }, 404);
}
function apiError(res, status, message) {
  json(res, { data: { message } }, status);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (!authorized(req, url)) return void json(res, { message: "unauthorized" }, 401);

  try {
    // --- event stream ---
    if (method === "GET" && path === "/event") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // --- sessions ---
    if (method === "POST" && path === "/session") {
      const directory = url.searchParams.get("directory") || process.cwd();
      const id = freshId("ses");
      const session = { id, title: "Untitled", directory, codexThreadId: null, createdAt: Date.now() };
      sessions.set(id, session);
      saveSessions();
      return void json(res, { id });
    }
    if (method === "GET" && (path === "/session" || path === "/experimental/session")) {
      const list = [...sessions.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => ({
          id: s.id,
          title: s.title,
          directory: s.directory,
          ...(s.parentId ? { parentID: s.parentId } : {}),
        }));
      return void json(res, list);
    }

    const sessionMatch = /^\/session\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      const sub = sessionMatch[2] ?? "";
      const session = sessions.get(id);
      if (!session) return void apiError(res, 404, "no such session");

      if (method === "DELETE" && !sub) {
        sessions.delete(id);
        saveSessions();
        return void json(res, true);
      }
      if (method === "GET" && sub === "message") return void json(res, readHistory(id));
      if (method === "POST" && sub === "prompt_async") {
        const body = await readBody(req);
        const text = (body.parts ?? [])
          .filter((p) => p?.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n");
        if (!text) return void apiError(res, 400, "empty prompt");
        if (runningTurns.has(id)) return void apiError(res, 409, "a turn is already running");
        const selectedSkills = Array.isArray(body.skills)
          ? body.skills
              .filter((name) => typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name))
              .slice(0, 20)
          : [];
        // body.agent (plan routing) is deliberately ignored on the Codex backend.
        void runTurn(session, text, { selectedSkills });
        return void json(res, { ok: true });
      }
      if (method === "POST" && sub === "review_async") {
        if (runningTurns.has(id)) return void apiError(res, 409, "a turn is already running");
        if (manualReviewTargets(session).length === 0) {
          return void apiError(res, 409, "No reviewable artifacts have been created in this task yet");
        }
        void runTurn(session, "Review artifacts", { reviewOnly: true });
        return void json(res, { ok: true });
      }
      if (method === "POST" && sub === "abort") {
        const turn = runningTurns.get(id);
        if (turn) {
          turn.aborted = true;
          turn.close();
        }
        return void json(res, Boolean(turn));
      }
      if (method === "POST" && sub === "shell") {
        if (sandboxMode() !== "danger-full-access")
          return void apiError(res, 403, "direct shell requires Full access; use the agent in Approve mode so Codex can sandbox the command");
        const body = await readBody(req);
        if (typeof body.command !== "string" || !body.command.trim())
          return void apiError(res, 400, "missing command");
        await runShell(session, body.command);
        return void json(res, { ok: true });
      }
      if (method === "POST" && sub === "command") {
        const body = await readBody(req);
        const skill = skillsFor(session.directory).find((item) => item.name === body.command);
        const prefix = skill ? `$${body.command}` : `/${body.command}`;
        const text = `${prefix}${body.arguments ? ` ${body.arguments}` : ""}`;
        if (runningTurns.has(id)) return void apiError(res, 409, "a turn is already running");
        void runTurn(session, text);
        return void json(res, { ok: true });
      }
      return void notFound(res);
    }

    // --- config / providers ---
    if (method === "GET" && path === "/config") return void json(res, {
      model: bridgeConfig.model ?? null,
      reviewer: bridgeConfig.reviewer,
    });
    if (path === "/global/config") {
      if (method === "GET") return void json(res, {
        model: bridgeConfig.model,
        provider: {},
        mcp: mcpServers(),
        reviewer: bridgeConfig.reviewer,
      });
      if (method === "PATCH") {
        const body = await readBody(req);
        if (typeof body.model === "string") bridgeConfig.model = body.model;
        if (body.reviewer && typeof body.reviewer === "object") {
          bridgeConfig.reviewer.enabled = false;
          if (typeof body.reviewer.autoFix === "boolean") {
            bridgeConfig.reviewer.autoFix = body.reviewer.autoFix;
          }
          // Reviewer v1 intentionally has exactly two review passes: initial
          // review, one Main-Agent fix, and one re-review. Never loop forever.
          bridgeConfig.reviewer.maxPasses = 2;
        }
        if (body.mcp && typeof body.mcp === "object") {
          for (const [name, config] of Object.entries(body.mcp)) {
            if (config === null) delete bridgeConfig.mcp[name];
            else bridgeConfig.mcp[name] = protectMcpSecrets(name, config);
          }
        }
        saveConfig();
        return void json(res, { ok: true });
      }
    }
    if (method === "GET" && path === "/config/providers") {
      return void json(res, {
        providers: [{ id: "openai", name: "Codex (OpenAI)", models: modelCatalog() }],
      });
    }
    if (method === "GET" && path === "/provider") {
      return void json(res, {
        all: [{ id: "openai", name: "Codex (OpenAI)", env: ["OPENAI_API_KEY"] }],
        connected: ["openai"],
      });
    }
    if (method === "GET" && path === "/provider/auth") {
      return void json(res, { openai: [{ type: "api", label: "API key" }] });
    }
    const authMatch = /^\/auth\/([^/]+)$/.exec(path);
    if (authMatch) {
      if (method === "PUT") {
        const body = await readBody(req);
        if (typeof body.key === "string") {
          runtimeApiKey = body.key.trim() || null;
          if (runtimeApiKey) process.env.OPENAI_API_KEY = runtimeApiKey;
          else delete process.env.OPENAI_API_KEY;
        }
        return void json(res, { ok: true });
      }
      if (method === "DELETE") {
        runtimeApiKey = null;
        delete process.env.OPENAI_API_KEY;
        return void json(res, { ok: true });
      }
    }

    // --- interactive requests: Codex uses sandboxing, not per-tool approvals ---
    if (method === "GET" && path === "/permission") return void json(res, []);
    if (method === "GET" && path === "/question") return void json(res, []);

    // --- discovery stubs the UI polls ---
    if (method === "GET" && path === "/api/skill") {
      return void json(res, { data: skillsFor(url.searchParams.get("directory")) });
    }
    if (method === "GET" && path === "/agent") return void json(res, [{
      name: "literature",
      description: "Independent read-only literature research subagent with evidence handoff to Main.",
      mode: "subagent",
    }]);
    if (method === "GET" && path === "/command") {
      return void json(res, skillsFor(url.searchParams.get("directory")).map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: "skill",
        template: `$${skill.name} $ARGUMENTS`,
      })));
    }
    if (method === "GET" && path === "/mcp") {
      const status = Object.fromEntries(Object.entries(mcpServers()).map(([name, config]) => [
        name,
        { status: config.enabled === false ? "disabled" : mcpStatuses.get(name) ?? "pending" },
      ]));
      return void json(res, status);
    }
    const mcpMatch = /^\/mcp\/([^/]+)$/.exec(path);
    if (mcpMatch && method === "DELETE") {
      delete bridgeConfig.mcp[decodeURIComponent(mcpMatch[1])];
      saveConfig();
      return void json(res, { ok: true });
    }
    if (method === "POST" && path === "/instance/dispose") return void json(res, { ok: true });

    notFound(res);
  } catch (err) {
    apiError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

server.listen(PORT, HOSTNAME, () => {
  console.error(`codex-bridge listening on http://${HOSTNAME}:${PORT} (agent: OpenAI Codex SDK)`);
});
