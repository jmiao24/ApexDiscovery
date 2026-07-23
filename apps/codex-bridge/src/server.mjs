#!/usr/bin/env node
// codex-bridge: the OpenAI Codex app-server behind the stable APEX Runtime API.
// It speaks the HTTP + SSE subset consumed by packages/sdk's ApexRuntimeClient.
//
// Codex-specific notes:
// - Approvals: app-server keeps a bidirectional JSON-RPC connection open, so
//   Codex's native command/file approval requests are relayed to APEX.
// - Steering: a prompt sent while a turn is running uses `turn/steer`.
// - Plan mode: the `agent` field on prompt_async is ignored (no plan routing).
// - Auth: uses OPENAI_API_KEY from the parent process or an in-memory value
//   supplied through Settings. The installed SDK vendors the Codex binary.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerCodex,
  appServerApprovalDecision,
  CodexAppServer,
} from "./codex-app-server.mjs";
import { apexExecutionMcpConfig, mainCodexConfig } from "./codex-client-config.mjs";
import { commandExecutionMetadata } from "./command-description.mjs";
import { normalizeNetworkDomains } from "./codex-sandbox.mjs";
import {
  discoverSkills,
  effectiveMcpServers,
  invokedSkills,
  loadedSkillContext,
  pluginReadRoots,
  skillCatalogContext,
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
  reconcileOrphanedSubagentSteps,
} from "./subagents.mjs";
import { executionJobFromResult } from "./execution-result.mjs";
import {
  EVIDENCE_SKILL_NAMES,
  auditInlineCitations,
  citationCheckingEnabled,
  citationRepairPrompt,
  userRequestedBibliography,
} from "./inline-citations.mjs";
import { APEX_MAIN_AGENT_PROMPT } from "./main-agent-prompt.mjs";
import { researchResultFromResult } from "./research-result.mjs";
import { researchRoute } from "./research-routing.mjs";

// ---- CLI / environment contract ----
const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const HOSTNAME = argValue("--hostname", "127.0.0.1");
const PORT = Number(argValue("--port", "4096"));
const PASSWORD = process.env.APEX_RUNTIME_PASSWORD || "";
const AUTH_TOKEN = PASSWORD ? Buffer.from(`apex:${PASSWORD}`).toString("base64") : null;

const DATA_HOME = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
const CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const CODEX_HOME = process.env.CODEX_HOME || join(CONFIG_HOME, "codex");
const EXTENSIONS_DIR = process.env.APEX_EXTENSIONS_DIR || "";
const BUNDLED_SKILLS_DIR = join(CONFIG_HOME, "apex-runtime", "skills");
const SOURCE_CORE_SKILLS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../runtime/skills/core",
);
const SOURCE_ADDITIONAL_SKILL_ROOTS = [
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../ClaudeAgent/skills"),
];
const SYSTEM_SKILLS_DIR = join(CODEX_HOME, "skills", ".system");
const APEX_DISCOVERY_SKILLS = Object.freeze([
  "assess-disease-expansion",
  "evaluate-label-expansion",
  "paperclip",
  "query-purple-book",
  "imagegen",
  "skill-creator",
  "skill-installer",
  "plugin-creator",
  "depmap",
  "cellxgene-census",
  "dailymed",
  "open-targets",
  "rare-variant-burden",
]);
const STORE_DIR = join(DATA_HOME, "codex-bridge");
const HISTORY_DIR = join(STORE_DIR, "history");
const SCIENCE_MCP_PATH = join(dirname(fileURLToPath(import.meta.url)), "science-mcp.mjs");
// Dormant custom research MCP entrypoint, retained for a future structured mode:
// const RESEARCH_MCP_PATH = join(dirname(fileURLToPath(import.meta.url)), "research-mcp.mjs");
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
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
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
try {
  bridgeConfig.execution = {
    allowedDomains: normalizeNetworkDomains(bridgeConfig.execution?.allowedDomains ?? []),
  };
} catch {
  bridgeConfig.execution = { allowedDomains: [] };
}
// Review is user-triggered from the task composer. Keep the legacy field for
// wire compatibility, but never turn artifact review into a background action.
bridgeConfig.reviewer.enabled = false;
const saveConfig = () => writeJson(configPath, bridgeConfig);
saveConfig();

let runtimeApiKey = process.env.OPENAI_API_KEY || null;
const mcpStatuses = new Map();

const EXECUTION_TOOL_CONTRACT = `## APEX execution tools
Use Codex's native command execution for CLI and shell commands, and the apex_execution MCP's ExecuteCode for notebook-first analysis:
- Native command execution is the only tool for CLI and shell commands, including package installation, documentation lookup, file inspection, and database/search CLIs. Its command and stdout remain in conversation history, but are never written to the reproducibility notebook. If Codex requests additional permissions, wait for the user's approval in APEX.
- When a CLI reports a DNS, connection, or network-sandbox failure, retry the same command by requesting the required network permission. Do not stop after the first sandboxed failure or replace the requested CLI with generic web search.
- Useful CLI output is not disposable: cite or summarize it directly when sufficient. When it must become formal research data, use ExecuteCode to parse it into a table/file/artifact so that transformation is captured in the notebook.
- ExecuteCode accepts only Python or R and is the default for formal data analysis, calculations, transformations, and plotting. Put the complete code for each logical step directly in the code argument so the notebook is self-contained. Split longer work into incremental calls and reuse Python/R state from earlier calls.
- Never create a .py or .R file as a staging mechanism and then run, import, exec, source, or shell that file from ExecuteCode. Write a script only when the user explicitly requests one, or export it after the notebook-first analysis is already validated.
- human_description is required on every ExecuteCode call. Write a distinct 3-8 word action label that identifies the concrete operation and object. Never reuse a generic label such as "Running code".
- Use environment="workspace" unless the platform exposes another environment.`;

function mcpServers() {
  return effectiveMcpServers(bridgeConfig.mcp, EXTENSIONS_DIR);
}

function codexClient(session, { allowSubagents = true } = {}) {
  const configured = toCodexMcpServers(mcpServers(), process.env);
  // Keep the custom APEX research MCP dormant for now. Codex native live
  // research supports both discovery and opening exact URLs under the active
  // Codex authentication, without requiring a second research credential.
  // To restore the richer structured APEX result envelope later, replace this
  // empty map with the registration block below and opt in via researchRoute:
  // const research = route.useApexResearch
  //   ? {
  //       apex_research: {
  //         command: process.execPath,
  //         args: [RESEARCH_MCP_PATH],
  //         enabled: true,
  //       },
  //     }
  //   : {};
  const research = {};
  // Keep notebook-first ExecuteCode as an APEX MCP, while native Codex command
  // execution handles CLI work and can request approval through app-server.
  const executionMode = sandboxMode();
  const execution = apexExecutionMcpConfig({
    processPath: process.execPath,
    scienceMcpPath: SCIENCE_MCP_PATH,
    workspaceRoot: session.directory || process.cwd(),
    sessionId: session.id,
    executionMode,
    allowedDomains: bridgeConfig.execution.allowedDomains,
  });
  const mcpConfig = { ...configured, ...research, ...execution };
  return new AppServerCodex(appServer(), {
    sessionId: session.id,
    config: mainCodexConfig({
      mcpServers: mcpConfig,
      hasApexExecution: "apex_execution" in mcpConfig,
      allowSubagents,
    }),
  });
}

// Reviewer threads deliberately receive no MCP servers. A filesystem
// read-only sandbox prevents local mutation; removing MCPs also prevents a
// reviewer from accidentally invoking an externally mutating connector.
// Network remains available per-thread for read-only citation verification.
function reviewerCodexClient(session) {
  return new AppServerCodex(appServer(), {
    sessionId: session.id,
    config: { mcp_servers: {}, features: { shell_tool: false } },
  });
}

function skillsFor(directory) {
  return discoverSkills({
    directory,
    home: homedir(),
    codexHome: CODEX_HOME,
    extensionsDir: EXTENSIONS_DIR,
    bundledSkillRoot: BUNDLED_SKILLS_DIR,
    coreSkillRoot: SOURCE_CORE_SKILLS_DIR,
    systemSkillRoot: SYSTEM_SKILLS_DIR,
    additionalSkillRoots: SOURCE_ADDITIONAL_SKILL_ROOTS,
    allowedSkillNames: APEX_DISCOVERY_SKILLS,
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
const updateHistoryToolState = (id, callId, state) => {
  const all = readHistory(id);
  let updated = false;
  for (const message of all) {
    for (const part of message?.parts ?? []) {
      if (part?.type === "tool" && part.callID === callId) {
        part.state = state;
        updated = true;
      }
    }
  }
  if (updated) writeJson(historyPath(id), all);
};
const readReconciledHistory = (id) => {
  const result = reconcileOrphanedSubagentSteps(
    readHistory(id),
    (childSessionId) => runningTurns.has(childSessionId),
  );
  if (result.repaired) writeJson(historyPath(id), result.history);
  return result.history;
};

function deleteSessionTree(rootId) {
  const deleted = new Set();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop();
    if (!id || deleted.has(id)) continue;
    deleted.add(id);
    for (const [childId, child] of sessions) {
      if (child.parentId === id) pending.push(childId);
    }
  }

  const active = [...deleted].find((id) => runningTurns.has(id));
  if (active) throw Object.assign(new Error("Cannot delete a session while it is running"), { status: 409 });

  for (const id of deleted) sessions.delete(id);
  saveSessions();
  for (const id of deleted) rmSync(historyPath(id), { force: true });
  return deleted.size;
}

// ---- SSE hub ----
const sseClients = new Set();
function broadcast(type, properties) {
  const frame = `data: ${JSON.stringify({ type, properties })}\n\n`;
  for (const res of sseClients) res.write(frame);
}
setInterval(() => {
  for (const res of sseClients) res.write(": keepalive\n\n");
}, 25_000).unref();

// ---- bidirectional Codex requests ----
const pendingPermissions = new Map();
const pendingQuestions = new Map();
let appServerInstance = null;

function publicRequestId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function appServer() {
  if (appServerInstance) return appServerInstance;
  appServerInstance = new CodexAppServer({
    env: runtimeApiKey ? { CODEX_API_KEY: runtimeApiKey, OPENAI_API_KEY: runtimeApiKey } : undefined,
    onStderr: (line) => {
      if (/error|warn/i.test(line)) process.stderr.write(`[codex app-server] ${line}\n`);
    },
    onServerRequest: handleCodexServerRequest,
  });
  appServerInstance.subscribe(handleCodexNotification);
  return appServerInstance;
}

function restartAppServer() {
  appServerInstance?.close();
  appServerInstance = null;
}

function requestSession(message, server) {
  return server.sessionForThread(message.params?.threadId)
    ?? [...sessions.values()].find((session) => session.codexThreadId === message.params?.threadId)?.id
    ?? null;
}

function permissionResources(params) {
  return [...new Set([
    params.command,
    params.cwd,
    params.reason,
    params.grantRoot,
    params.networkApprovalContext?.host,
  ].filter((value) => typeof value === "string" && value.trim()))];
}

function handleCodexServerRequest(message, server) {
  const sessionId = requestSession(message, server);
  if (message.method === "item/commandExecution/requestApproval"
      || message.method === "item/fileChange/requestApproval") {
    const requestId = publicRequestId("perm");
    const action = message.method.includes("commandExecution") ? "bash" : "write";
    const entry = {
      id: requestId,
      sessionID: sessionId,
      permission: action,
      patterns: permissionResources(message.params ?? {}),
      rpcId: message.id,
      method: message.method,
      proposedExecpolicyAmendment: message.params?.proposedExecpolicyAmendment,
      threadId: message.params?.threadId,
      server,
    };
    pendingPermissions.set(requestId, entry);
    broadcast("permission.asked", {
      sessionID: sessionId,
      id: requestId,
      permission: action,
      patterns: entry.patterns,
    });
    return;
  }
  if (message.method === "item/tool/requestUserInput") {
    const requestId = publicRequestId("question");
    const questions = (message.params?.questions ?? []).map((question) => ({
      question: question.question,
      header: question.header,
      options: (question.options ?? []).map((option) => ({
        label: option.label,
        description: option.description,
      })),
      custom: Boolean(question.isOther),
    }));
    pendingQuestions.set(requestId, {
      id: requestId,
      sessionID: sessionId,
      questions,
      sourceQuestions: message.params?.questions ?? [],
      threadId: message.params?.threadId,
      rpcId: message.id,
      server,
    });
    broadcast("question.asked", { sessionID: sessionId, id: requestId, questions });
    return;
  }
  server.respondError(message.id, -32601, `APEX does not support ${message.method} yet`);
}

function handleCodexNotification(message) {
  if (message.method !== "serverRequest/resolved") return;
  const rawId = message.params?.requestId;
  for (const entry of pendingPermissions.values()) {
    if (entry.rpcId !== rawId) continue;
    pendingPermissions.delete(entry.id);
    broadcast("permission.replied", { sessionID: entry.sessionID, requestID: entry.id });
  }
  for (const entry of pendingQuestions.values()) {
    if (entry.rpcId !== rawId) continue;
    pendingQuestions.delete(entry.id);
    broadcast("question.replied", { sessionID: entry.sessionID, requestID: entry.id });
  }
}

function resolvePermission(entry, reply) {
  const decision = appServerApprovalDecision(reply, entry);
  entry.server.respond(entry.rpcId, { decision });
  pendingPermissions.delete(entry.id);
  broadcast("permission.replied", { sessionID: entry.sessionID, requestID: entry.id });
}

function resolveQuestion(entry, answers) {
  const mapped = {};
  entry.sourceQuestions.forEach((question, index) => {
    mapped[question.id] = { answers: Array.isArray(answers?.[index]) ? answers[index] : [] };
  });
  entry.server.respond(entry.rpcId, { answers: mapped });
  pendingQuestions.delete(entry.id);
  broadcast("question.replied", { sessionID: entry.sessionID, requestID: entry.id });
}

// ---- running turns ----
/** sessionId → active bridge turn, including the steerable Main Agent thread. */
const runningTurns = new Map();
let idCounter = 0;
const freshId = (prefix) => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;
const MAX_SKILL_BYTES = 512 * 1024;

// The app's approval switch writes the APEX Runtime permission config; map it to
// Codex's sandbox: approve → workspace-write, full → danger-full-access.
function sandboxMode() {
  for (const name of ["config.jsonc", "config.json"]) {
    const cfg = readJson(join(CONFIG_HOME, "apex-runtime", name), null);
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

  const turn = {
    aborted: false,
    closers: new Set(),
    activeThreads: new Set(),
    mainThread: null,
    close() {
      for (const close of this.closers) close();
      for (const thread of this.activeThreads) void thread.interrupt?.().catch(() => {});
    },
  };
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
    // A child may finish after Codex's MCP call has timed out and the parent
    // history has already been serialized. Persist that late terminal state.
    updateHistoryToolState(session.id, step.callId, state);
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
  const evidenceSkillSelected = loadedSkills.some(({ skill }) => EVIDENCE_SKILL_NAMES.has(skill.name));
  const allowBibliography = userRequestedBibliography(promptText);

  // "default" (or unset) leaves the model to ~/.codex/config.toml.
  const chosen = (bridgeConfig.model ?? "").split("/").pop();
  const research = researchRoute(runtimeApiKey);
  const threadOptions = {
    workingDirectory: session.directory || process.cwd(),
    ...(chosen && chosen !== "default" ? { model: chosen } : {}),
    sandboxMode: sandboxMode(),
    // Enterprise-managed Codex profiles may require on-request approvals. The
    // app-server transport relays those requests to APEX's existing permission
    // card without weakening the user's managed policy.
    approvalPolicy: "on-request",
    // Use Codex native live research under both ChatGPT-managed and API-key
    // authentication. The custom APEX research MCP remains dormant above.
    webSearchMode: research.webSearchMode,
    skipGitRepoCheck: true,
    additionalDirectories: [
      ...pluginReadRoots(EXTENSIONS_DIR),
      ...(existsSync(BUNDLED_SKILLS_DIR) ? [BUNDLED_SKILLS_DIR] : []),
    ],
  };

  const skillContext = skillCatalogContext(discoveredSkills);
  const loadedContext = loadedSkillContext(loadedSkills);
  const executionContext = EXECUTION_TOOL_CONTRACT;
  const codexPrompt = [APEX_MAIN_AGENT_PROMPT, research.prompt, executionContext, skillContext, loadedContext, promptText]
    .filter(Boolean)
    .join("\n\n");

  try {
    const codex = codexClient(session);
    const mainThread = session.codexThreadId
      ? codex.resumeThread(session.codexThreadId, threadOptions)
      : codex.startThread(threadOptions);
    turn.mainThread = mainThread;

    /** Stream one Main/Reviewer/Fix phase through the APEX Runtime event stream. */
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
      const result = {
        texts: [],
        textParts: [],
        changedPaths: [],
        notebookPaths: [],
        commands: [],
        externalEvidenceUsed: false,
        failed: null,
        outputParts: targetParts,
        targetSessionId,
      };
      const itemIndex = new Map();
      const { events } = await thread.runStreamed(prompt);
      const closeEvents = () => void events.return?.();
      turn.closers.add(closeEvents);
      turn.activeThreads.add(thread);
      const prefix = phase.replace(/[^a-zA-Z0-9_-]/g, "_");

      try {
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
            const visibleText = item.text ?? "";
            if (recordText) emitText(partId, visibleText, targetSessionId);
            if (event.type === "item.completed" && visibleText) {
              result.texts.push(visibleText);
              if (recordText) {
                const part = { type: "text", id: partId, text: visibleText };
                targetParts.push(part);
                result.textParts.push({ partId, part });
              }
            }
            break;
          }
          case "command_execution": {
            const callId = `cll_${prefix}_${item.id}`;
            const running = event.type !== "item.completed";
            const metadata = commandExecutionMetadata(item.command, phase);
            const state = {
              status: running ? "running" : item.status === "failed" ? "error" : "completed",
              ...metadata,
              output: running ? undefined : item.aggregated_output ?? "",
              time: running ? { start: Date.now() } : undefined,
            };
            if (running && !itemIndex.has(item.id)) {
              itemIndex.set(item.id, targetParts.length);
              targetParts.push({ type: "tool", tool: "bash", callID: callId, state: { ...state, time: { start: Date.now() } } });
            } else if (!running) {
              result.commands.push(item.command);
              if (/\bpaperclip\b|https?:\/\/|\b(?:dailymed|open[-_ ]targets|purple[-_ ]book|depmap|cellxgene|uniprot|chembl|pdb)\b/i.test(item.command)) {
                result.externalEvidenceUsed = true;
              }
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
            const isExecution = item.server === "apex_execution";
            const isResearch = item.server === "apex_research";
            const executionJob = isExecution ? executionJobFromResult(item.result) : null;
            const researchResult = isResearch ? researchResultFromResult(item.result) : null;
            const structured = item.result?.structured_content && typeof item.result.structured_content === "object"
              ? item.result.structured_content
              : executionJob ?? researchResult;
            const output = isExecution && typeof executionJob?.output === "string"
              ? executionJob.output
              : isResearch && researchResult
                ? JSON.stringify(researchResult)
              : item.error?.message
                ?? (item.result ? JSON.stringify(structured ?? item.result.content ?? "") : undefined);
            const baseInput = item.arguments && typeof item.arguments === "object"
              ? {
                  ...item.arguments,
                  ...(executionJob?.notebook_path ? { notebook_path: executionJob.notebook_path } : {}),
                  ...(Number.isInteger(executionJob?.notebook_cell_index)
                    ? { notebook_cell_index: executionJob.notebook_cell_index }
                    : {}),
                }
              : { value: item.arguments };
            const humanDescription = (isExecution || isResearch) && typeof baseInput.human_description === "string"
              ? baseInput.human_description.trim()
              : "";
            const mappedTool = isExecution && item.tool === "Bash"
              ? "bash"
              : isExecution && item.tool === "ExecuteCode"
                ? "execute_code"
                : isResearch && item.tool === "WebSearch"
                  ? "websearch"
                  : isResearch && item.tool === "WebFetch"
                    ? "webfetch"
                : "mcp";
            const state = {
              status: running ? "running" : item.status === "failed" ? "error" : "completed",
              title: humanDescription || ((isExecution || isResearch) ? "Missing activity description" : `${item.server}.${item.tool}`),
              input: {
                ...baseInput,
                phase,
                ...(humanDescription ? { human_description: humanDescription } : {}),
                ...((isExecution || isResearch) && !humanDescription ? { description_missing: true } : {}),
              },
              ...(running ? {} : { output: output?.slice(0, 100_000) ?? "" }),
              time: running ? { start: Date.now() } : { start: Date.now(), end: Date.now() },
            };
            if (!running) {
              mcpStatuses.set(item.server, item.status === "failed" ? "failed" : "connected");
              if (isResearch || /(?:paper|literature|trial|protein|uniprot|pdb|chembl|drug|target|regulatory)/i.test(`${item.server} ${item.tool}`)) {
                result.externalEvidenceUsed = true;
              }
              if (isExecution && item.tool === "ExecuteCode" && executionJob?.notebook_path) {
                result.notebookPaths.push(executionJob.notebook_path);
              }
              targetParts.push({ type: "tool", tool: mappedTool, callID: callId, state });
            }
            emitToolUpdate(callId, mappedTool, state, targetSessionId);
            break;
          }
          case "web_search": {
            if (event.type !== "item.completed") break;
            result.externalEvidenceUsed = true;
            // The bridge currently flattens search/open/find actions into a
            // single `query` string. Some open-page events arrive with an empty
            // query because the SDK does not expose the underlying action URL.
            // An invented "web search" row is misleading and has no useful
            // detail to inspect, so omit only those empty events.
            const query = typeof item.query === "string" ? item.query.trim() : "";
            if (!query) break;
            const callId = `cll_${prefix}_${item.id}`;
            const state = {
              status: "completed",
              title: query,
              input: {
                pattern: query,
                phase,
              },
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
      } finally {
        turn.closers.delete(closeEvents);
        turn.activeThreads.delete(thread);
      }
      return result;
    };

    const publishPhaseText = (result, text, phase) => {
      for (const entry of result.textParts ?? []) {
        entry.part.text = "";
        emitText(entry.partId, "", result.targetSessionId);
      }
      const finalText = String(text ?? "").trim();
      result.texts = finalText ? [finalText] : [];
      result.textParts = [];
      if (!finalText) return;
      const partId = freshId(`prt_${phase}_verified`);
      const part = { type: "text", id: partId, text: finalText };
      result.outputParts.push(part);
      result.textParts.push({ partId, part });
      emitText(partId, finalText, result.targetSessionId);
    };

    const enforceInlineCitations = async ({ result, thread, phase, required, buffered }) => {
      const answer = result.texts.join("\n\n").trim();
      const checkingEnabled = citationCheckingEnabled();
      if (!checkingEnabled || !required) {
        if (buffered && answer) publishPhaseText(result, answer, phase);
        return {
          ok: true,
          repaired: false,
          blocked: false,
          ...(required && !checkingEnabled ? { skipped: true } : {}),
        };
      }

      const audit = auditInlineCitations(answer, { required: true, allowBibliography });
      if (audit.ok) {
        if (buffered && answer) publishPhaseText(result, answer, phase);
        return { ok: true, repaired: false, blocked: false, audit };
      }

      const step = beginWorkflowStep("citation", "Citation check — improving inline evidence links", {
        phase,
        citation_count: audit.citationCount,
        factual_claim_count: audit.factualClaimCount,
        uncited_claim_count: audit.uncitedClaims.length,
        issues: audit.issues,
      });
      const repair = await streamPhase({
        thread,
        prompt: citationRepairPrompt({ answer, audit, allowBibliography }),
        phase: `${phase}-citation-repair`,
        recordText: false,
        surfaceErrors: false,
      });
      const repairedText = repair.texts.join("\n\n").trim();
      const repairedAudit = auditInlineCitations(repairedText, { required: true, allowBibliography });
      result.externalEvidenceUsed ||= repair.externalEvidenceUsed;

      if (!repair.failed && repairedAudit.ok) {
        publishPhaseText(result, repairedText, phase);
        finishWorkflowStep(step, {
          title: "Citation check — passed after repair",
          output: `${repairedAudit.citationCount} inline citation${repairedAudit.citationCount === 1 ? "" : "s"}; ${repairedAudit.factualClaimCount} checked factual claim unit${repairedAudit.factualClaimCount === 1 ? "" : "s"}`,
        });
        return { ok: true, repaired: true, blocked: false, audit: repairedAudit };
      }

      // Citation repair is best-effort. Local matrices, private records, and
      // workspace artifacts may not have an HTTP record page, so incomplete
      // links must never replace the research answer with a blocking message.
      const bestAvailableAnswer = repairedText || answer;
      publishPhaseText(result, bestAvailableAnswer, phase);
      finishWorkflowStep(step, {
        title: "Citation check — best available answer published",
        output: repair.failed
          ?? (repairedAudit.issues.join(" ") || "Some local or private evidence could not be linked automatically."),
      });
      return { ok: false, repaired: true, blocked: false, audit: repairedAudit };
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

      const childSelectedSkills = invokedSkills(
        `$paperclip ${delegatedLiteratureTask}`,
        discoveredSkills,
        loadedSkills.map(({ skill }) => skill.name),
      );
      const childSandbox = sandboxMode();
      const childTools = [
        "Live web research",
        "Bash",
        "ExecuteCode",
        ...Object.keys(mcpServers()).map((name) => `MCP · ${name}`),
      ];
      const taskStep = beginWorkflowStep(
        "task",
        "Literature Agent — researching evidence",
        {
          agent: "literature",
          task: delegatedLiteratureTask,
          sandbox: childSandbox,
          tools: childTools,
          skills: childSelectedSkills.map((skill) => skill.name),
          available_skill_count: new Set(discoveredSkills.map((skill) => skill.name)).size,
          canLaunchSubagents: false,
        },
        { sessionId: childId },
      );
      const childParts = [];
      const childSkills = loadSkills(
        childSelectedSkills,
        "literature-subagent",
        childId,
        childParts,
      );
      const childThread = codexClient(childSession, { allowSubagents: false }).startThread(threadOptions);
      let childResult;
      runningTurns.set(childId, turn);
      try {
        childResult = await streamPhase({
          thread: childThread,
          prompt: [
            APEX_MAIN_AGENT_PROMPT,
            research.prompt,
            executionContext,
            literatureAgentPrompt({
              task: delegatedLiteratureTask,
              skillCatalog: skillContext,
              skillContext: loadedSkillContext(childSkills),
            }),
          ].filter(Boolean).join("\n\n"),
          phase: "literature-subagent",
          targetSessionId: childId,
          targetParts: childParts,
          onThreadStarted: (threadId) => {
            childSession.codexThreadId = threadId;
            saveSessions();
          },
        });
      } finally {
        runningTurns.delete(childId);
      }
      if (childParts.length) {
        appendHistory(childId, {
          info: { id: freshId("msg"), role: "assistant", time: { completed: Date.now() } },
          parts: childParts,
        });
      }
      broadcast("session.idle", { sessionID: childId });

      if (turn.aborted) {
        finishWorkflowStep(taskStep, {
          title: "Literature Agent — cancelled",
          output: "The user cancelled the literature subagent.",
          error: true,
        });
        return;
      }

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
      const synthesisResult = await streamPhase({
        thread: mainThread,
        prompt: literatureSynthesisPrompt({
          task: delegatedLiteratureTask,
          memo: memo || `The literature subagent failed: ${childResult.failed ?? "no evidence memo returned"}`,
        }),
        phase: "main-synthesis",
        recordText: false,
        onThreadStarted: (threadId) => {
          session.codexThreadId = threadId;
          saveSessions();
        },
      });
      if (!turn.aborted && !synthesisResult.failed) {
        await enforceInlineCitations({
          result: synthesisResult,
          thread: mainThread,
          phase: "main-synthesis",
          required: true,
          buffered: true,
        });
      }
      return;
    }

    let mainResult = { changedPaths: [], notebookPaths: [], failed: null };
    let targets;
    if (reviewOnly) {
      targets = manualReviewTargets(session);
    } else {
      const mainStartedAt = Date.now();
      mainResult = await streamPhase({
        thread: mainThread,
        prompt: codexPrompt,
        phase: "main",
        // Final prose is always buffered so an uncited scientific draft can
        // never be transiently published before the runtime gate evaluates it.
        recordText: false,
        onThreadStarted: (threadId) => {
          session.codexThreadId = threadId;
          saveSessions();
        },
      });
      if (!turn.aborted && !mainResult.failed) {
        await enforceInlineCitations({
          result: mainResult,
          thread: mainThread,
          phase: "main",
          required: evidenceSkillSelected || mainResult.externalEvidenceUsed,
          buffered: true,
        });
      }
      targets = reviewTargets(
        [...mainResult.changedPaths, ...mainResult.notebookPaths],
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
      const reviewerThread = reviewerCodexClient(session).startThread({
        ...threadOptions,
        sandboxMode: "read-only",
        networkAccessEnabled: true,
        webSearchMode: "live",
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
          [...targets, ...fixResult.changedPaths, ...fixResult.notebookPaths],
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
      state: {
        status: "running",
        title: "Running direct shell command",
        input: { command, human_description: "Running direct shell command" },
        time: { start: started },
      },
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
        title: "Running direct shell command",
        input: { command, human_description: "Running direct shell command" },
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
        deleteSessionTree(id);
        return void json(res, true);
      }
      if (method === "GET" && sub === "message") return void json(res, readReconciledHistory(id));
      if (method === "POST" && sub === "prompt_async") {
        const body = await readBody(req);
        const text = (body.parts ?? [])
          .filter((p) => p?.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n");
        if (!text) return void apiError(res, 400, "empty prompt");
        const selectedSkills = Array.isArray(body.skills)
          ? body.skills
              .filter((name) => typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name))
              .slice(0, 20)
          : [];
        const activeTurn = runningTurns.get(id);
        if (activeTurn) {
          if (!activeTurn.mainThread) return void apiError(res, 409, "the active turn is not steerable yet");
          const steeringText = selectedSkills.length
            ? `${selectedSkills.map((name) => `$${name}`).join(" ")}\n\n${text}`
            : text;
          appendHistory(id, {
            info: { id: freshId("msg"), role: "user", time: { completed: Date.now() } },
            parts: [{ type: "text", text }],
          });
          try {
            await activeTurn.mainThread.steer(steeringText);
          } catch (error) {
            return void apiError(res, 409, error instanceof Error ? error.message : String(error));
          }
          return void json(res, { ok: true, steered: true });
        }
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
      execution: bridgeConfig.execution,
    });
    if (path === "/global/config") {
      if (method === "GET") return void json(res, {
        model: bridgeConfig.model,
        provider: {},
        mcp: mcpServers(),
        reviewer: bridgeConfig.reviewer,
        execution: bridgeConfig.execution,
      });
      if (method === "PATCH") {
        const body = await readBody(req);
        let restartExecutionRuntime = false;
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
        if (body.execution && typeof body.execution === "object") {
          if (runningTurns.size) {
            return void apiError(res, 409, "finish or stop the active turn before changing ExecuteCode network access");
          }
          try {
            bridgeConfig.execution = {
              allowedDomains: normalizeNetworkDomains(body.execution.allowedDomains ?? []),
            };
          } catch (error) {
            return void apiError(res, 400, error instanceof Error ? error.message : String(error));
          }
          restartExecutionRuntime = true;
        }
        saveConfig();
        if (restartExecutionRuntime) restartAppServer();
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
        if (runningTurns.size) return void apiError(res, 409, "finish or stop the active turn before changing authentication");
        const body = await readBody(req);
        if (typeof body.key === "string") {
          runtimeApiKey = body.key.trim() || null;
          if (runtimeApiKey) process.env.OPENAI_API_KEY = runtimeApiKey;
          else delete process.env.OPENAI_API_KEY;
        }
        restartAppServer();
        return void json(res, { ok: true });
      }
      if (method === "DELETE") {
        if (runningTurns.size) return void apiError(res, 409, "finish or stop the active turn before changing authentication");
        runtimeApiKey = null;
        delete process.env.OPENAI_API_KEY;
        restartAppServer();
        return void json(res, { ok: true });
      }
    }

    // --- interactive requests relayed from the long-lived app-server ---
    if (method === "GET" && path === "/permission") {
      return void json(res, [...pendingPermissions.values()].map(({ id, sessionID, permission, patterns }) => ({
        id, sessionID, permission, patterns,
      })));
    }
    const permissionReply = /^\/permission\/([^/]+)\/reply$/.exec(path);
    if (method === "POST" && permissionReply) {
      const entry = pendingPermissions.get(decodeURIComponent(permissionReply[1]));
      if (!entry) return void apiError(res, 404, "no such permission request");
      const body = await readBody(req);
      if (!["once", "always", "reject"].includes(body.reply)) return void apiError(res, 400, "invalid permission reply");
      resolvePermission(entry, body.reply);
      return void json(res, { ok: true });
    }
    if (method === "GET" && path === "/question") {
      return void json(res, [...pendingQuestions.values()].map(({ id, sessionID, questions }) => ({
        id, sessionID, questions,
      })));
    }
    const questionReply = /^\/question\/([^/]+)\/(reply|reject)$/.exec(path);
    if (method === "POST" && questionReply) {
      const entry = pendingQuestions.get(decodeURIComponent(questionReply[1]));
      if (!entry) return void apiError(res, 404, "no such question request");
      const body = await readBody(req);
      const answers = questionReply[2] === "reject" ? [] : body.answers;
      resolveQuestion(entry, answers);
      return void json(res, { ok: true });
    }

    // --- discovery stubs the UI polls ---
    if (method === "GET" && path === "/api/skill/content") {
      const requested = url.searchParams.get("path");
      if (!requested || !isAbsolute(requested)) return void apiError(res, 400, "missing absolute skill path");
      const skill = skillsFor(url.searchParams.get("directory")).find(
        (item) => resolve(item.location) === resolve(requested),
      );
      if (!skill) return void apiError(res, 404, "skill is not installed in this workspace");
      const bytes = statSync(skill.location).size;
      if (bytes > MAX_SKILL_BYTES) return void apiError(res, 413, `SKILL.md is ${bytes} bytes; the preview limit is ${MAX_SKILL_BYTES} bytes`);
      return void json(res, { data: { ...skill, content: readFileSync(skill.location, "utf8") } });
    }
    if (method === "GET" && path === "/api/skill") {
      return void json(res, { data: skillsFor(url.searchParams.get("directory")) });
    }
    if (method === "GET" && path === "/agent") return void json(res, [
      {
        name: "literature",
        description: "Independent literature research subagent with Main-equivalent tools and evidence handoff.",
        mode: "subagent",
      },
    ]);
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
  console.error(`codex-bridge listening on http://${HOSTNAME}:${PORT} (agent: OpenAI Codex app-server)`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    appServerInstance?.close();
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
  });
}
