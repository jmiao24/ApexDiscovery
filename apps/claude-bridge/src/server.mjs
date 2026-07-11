#!/usr/bin/env node
// claude-bridge: an OpenCode-compatible HTTP+SSE server whose agent is the
// Claude Agent SDK. It speaks the exact wire subset packages/sdk's
// OpenCodeClient consumes, and accepts the same CLI/env contract as
// `opencode serve` (`serve --hostname H --port P`, OPENCODE_SERVER_PASSWORD,
// XDG_* dirs, cwd = workspace) — so the desktop shell and apexscience-server
// can spawn it as a drop-in sidecar and the React app runs unchanged.
//
// Protocol surface implemented (see OpenCodeClient.ts for the consumer):
//   GET  /event?directory=&auth_token=          SSE event stream
//   POST /session?directory=                    create session
//   GET  /session | /experimental/session       list sessions
//   DELETE /session/:id                         delete session
//   GET  /session/:id/message                   history
//   POST /session/:id/prompt_async              run a turn (events stream back)
//   POST /session/:id/abort                     interrupt the running turn
//   POST /session/:id/shell                     run a "!" shell command
//   POST /session/:id/command                   run a slash command as a prompt
//   GET  /config                                { model }
//   GET|PATCH /global/config                    bridge config (model, …)
//   GET  /config/providers                      the single "anthropic" provider
//   GET  /provider | /provider/auth             catalog stubs
//   PUT|DELETE /auth/:id                        store/remove an API key
//   GET  /api/skill?directory=                  workspace .claude/skills
//   GET  /agent | /command | /mcp | /question   stubs
//   GET  /permission                            pending approvals
//   POST /permission/:id/reply                  approve/deny a tool call
//   POST /instance/dispose                      no-op
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

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
const STORE_DIR = join(DATA_HOME, "claude-bridge");
const HISTORY_DIR = join(STORE_DIR, "history");
mkdirSync(HISTORY_DIR, { recursive: true });

const DEFAULT_MODEL = "claude-sonnet-4-5";
const MODELS = {
  "claude-sonnet-4-5": { name: "Claude Sonnet 4.5" },
  "claude-opus-4-8": { name: "Claude Opus 4.8" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5" },
};

// ---- tiny JSON stores (single-user local bridge; no concurrency to fight) ----
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
const bridgeConfig = readJson(configPath, { model: `anthropic/${DEFAULT_MODEL}` });
const saveConfig = () => writeJson(configPath, bridgeConfig);

const sessionsPath = join(STORE_DIR, "sessions.json");
/** id → { id, title, directory, claudeSessionId, createdAt } */
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

// Appended to the system prompt when the user allows planning. The MODEL decides
// whether a request deserves a plan (it calls EnterPlanMode) — the bridge does
// not force it. Once the model opts in, canUseTool enforces read-only for the
// rest of the turn, so "plan mode" is real, not just a promise in the prompt.
const PLANNING_GUIDANCE = [
  "",
  "<planning>",
  "Before using ANY tool, decide whether this request deserves a plan first.",
  "",
  "If it is multi-step, ambiguous, or consequential — an analysis pipeline, an open",
  "methodology or output choice, input data that is missing or unspecified, or work",
  "that would write many files or run for a long time — call EnterPlanMode",
  "(mcp__apex__EnterPlanMode) as your FIRST action, before exploring.",
  "",
  "If it is simple and clear (a question, reading a file, a small edit, a one-off",
  "command), do NOT call it — just do the work.",
  "",
  "After EnterPlanMode you are read-only for the rest of the turn: research with read",
  "tools, and if something essential is still unclear, call AskUserQuestion",
  "(mcp__apex__AskUserQuestion) to ask 1–4 multiple-choice questions with concrete",
  "options rather than asking in prose. Then present your plan as your final message",
  "and stop — execution begins on the user's next message.",
  "</planning>",
].join("\n");

// Read-only tools a planning turn may run without prompting the user — the
// research phase must not stall on approvals it would never be denied.
const PLAN_READONLY_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
  "NotebookRead",
  "Task",
  "TodoWrite",
]);

// ---- running turns / pending approvals ----
/** sessionId → { abort: AbortController } */
const runningTurns = new Map();
/** requestId → { sessionId, resolve(reply) } */
const pendingPermissions = new Map();
/** requestId → { sessionId, questions, resolve(answers|null) } — an open
 *  AskUserQuestion the user must answer (rendered as a selectable card). */
const pendingQuestions = new Map();
/** sessionId → Set<toolName> the user approved "always" for. */
const alwaysAllowed = new Map();
let idCounter = 0;
const freshId = (prefix) => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// The app's approval switch writes OpenCode's permission config; honor it.
// A `permission.bash` object = "approve" mode; `permission: {}` = full access.
function permissionMode() {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const cfg = readJson(join(CONFIG_HOME, "opencode", name), null);
    if (cfg && typeof cfg === "object" && "permission" in cfg) {
      return cfg.permission && typeof cfg.permission.bash === "object" ? "default" : "bypassPermissions";
    }
  }
  return "default";
}

// ---- Claude ↔ OpenCode mapping ----
const TOOL_NAMES = {
  Bash: "bash",
  Write: "write",
  Edit: "edit",
  Read: "read",
  Grep: "grep",
  Glob: "glob",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  Task: "task",
  Skill: "skill",
  TodoWrite: "todo",
  NotebookEdit: "edit",
};
const mapToolName = (name) => TOOL_NAMES[name] ?? name.toLowerCase();

/** Claude tool input → the camelCase keys the UI's toolPresentation reads. */
function mapToolInput(input) {
  if (!input || typeof input !== "object") return input ?? {};
  const out = { ...input };
  if (typeof input.file_path === "string") out.filePath = input.file_path;
  if (typeof input.notebook_path === "string") out.filePath = input.notebook_path;
  return out;
}

function toolTitle(name, input) {
  if (typeof input?.command === "string") return input.command;
  if (typeof input?.file_path === "string") return input.file_path;
  if (typeof input?.pattern === "string") return input.pattern;
  if (typeof input?.url === "string") return input.url;
  if (typeof input?.description === "string") return input.description;
  return mapToolName(name);
}

/** The approval target shown to the user (a command line, a path, a URL). */
function permissionPatterns(toolName, input) {
  const t = toolTitle(toolName, input);
  return [t];
}

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

// ---- interactive clarifying questions (AskUserQuestion) ----
// Broadcast a `question.asked` the UI renders as a selectable card, and resolve
// once the user replies (an array of picked labels per question) or skips (null).
function askUser(sessionId, questions) {
  const requestId = freshId("qst");
  const mapped = questions.map((q) => ({
    question: String(q.question ?? ""),
    header: String(q.header ?? ""),
    options: (q.options ?? []).map((o) => ({
      label: String(o.label ?? ""),
      description: String(o.description ?? ""),
    })),
    multiple: !!q.multiSelect,
    // Always offer a typed "Other" answer alongside the options.
    custom: true,
  }));
  broadcast("question.asked", { id: requestId, sessionID: sessionId, questions: mapped });
  return new Promise((resolve) => {
    pendingQuestions.set(requestId, { sessionId, questions: mapped, resolve });
  });
}

/**
 * The agent's own tools, served in-process (`mcp__apex__*`):
 *
 *   EnterPlanMode    the model's OWN decision that this request deserves a plan.
 *                    Calling it flips the turn read-only (enforced in canUseTool)
 *                    — the model then researches, may ask clarifying questions,
 *                    and ends the turn with a plan instead of executing. Only
 *                    offered when the user allows planning.
 *   AskUserQuestion  multiple-choice clarifying questions, surfaced to the UI as
 *                    a `question.asked` card; the user's picks come back as the
 *                    tool result. Mirrors Claude Code's own AskUserQuestion shape
 *                    so the model reaches for it naturally.
 *
 * `onEnterPlan` is how the turn learns the model opted in.
 */
function apexToolsFor(session, { planAllowed, onEnterPlan }) {
  const tools = [];
  if (planAllowed) {
    tools.push(
      tool(
        "EnterPlanMode",
        "Enter read-only plan mode for this turn. Call this FIRST when the request is " +
          "multi-step, ambiguous, or consequential (an analysis pipeline, an open " +
          "methodology or output choice, missing input data, or work that writes many " +
          "files). Do not call it for simple, clear requests — just do those. After " +
          "calling it you cannot edit files or run commands: research, optionally ask " +
          "the user clarifying questions, then present a plan and stop.",
        {
          reason: z.string().describe("Why this request needs a plan before executing."),
          description: z.string().describe("Short title for the planning step (≈8 words)."),
        },
        async ({ reason, description }) => {
          onEnterPlan({ reason, description });
          return { content: [{ type: "text", text: JSON.stringify({ enter_plan_mode: true }) }] };
        },
        // Load it up front. Deferred, the model has to run a tool search to
        // discover it — which it does mid-turn, slowly, or not at all.
        { alwaysLoad: true },
      ),
    );
  }
  tools.push(
    tool(
      "AskUserQuestion",
        "Ask the user 1–4 clarifying multiple-choice questions before proceeding. " +
          "Use when the request is ambiguous or underspecified (missing data source, " +
          "unclear scope, output format, or methodology). Each question is shown to the " +
          "user as selectable options; they may also type their own answer.",
        {
          questions: z
            .array(
              z.object({
                question: z.string().describe("The full question to ask the user."),
                header: z.string().describe("A short label for the question (≈12 chars)."),
                multiSelect: z
                  .boolean()
                  .optional()
                  .describe("Allow selecting more than one option."),
                options: z
                  .array(
                    z.object({
                      label: z.string(),
                      description: z.string().optional(),
                    }),
                  )
                  .min(2)
                  .max(4)
                  .describe("2–4 concrete choices."),
              }),
            )
            .min(1)
            .max(4),
        },
        async ({ questions }) => {
          const answers = await askUser(session.id, questions);
          if (!answers) {
            return {
              content: [
                {
                  type: "text",
                  text: "The user skipped the questions. Proceed with sensible defaults and state your assumptions in the plan.",
                },
              ],
            };
          }
          const summary = questions
            .map((q, i) => `- ${q.header || q.question}: ${(answers[i] ?? []).join(", ") || "(no answer)"}`)
            .join("\n");
          return { content: [{ type: "text", text: `The user answered:\n${summary}` }] };
        },
        { alwaysLoad: true },
      ),
  );
  return createSdkMcpServer({ name: "apex", version: "1.0.0", tools });
}

// ---- the agent turn ----
// `planAllowed` only OFFERS the model EnterPlanMode — whether this turn actually
// becomes a plan is the model's call, and is recorded in `planning` below.
async function runTurn(session, promptText, { planAllowed = false } = {}) {
  if (runningTurns.has(session.id)) throw Object.assign(new Error("A turn is already running"), { status: 409 });

  // Record the user message (the UI shows its own copy locally; history is
  // what a reload renders).
  appendHistory(session.id, {
    info: { id: freshId("msg"), role: "user", time: { completed: Date.now() } },
    parts: [{ type: "text", text: promptText }],
  });
  if (!session.title || session.title === "Untitled") {
    session.title = promptText.slice(0, 60).replace(/\s+/g, " ").trim() || "Untitled";
    saveSessions();
  }

  const abort = new AbortController();
  runningTurns.set(session.id, { abort });

  // Assembled as the turn progresses; flushed to history at the end.
  const assistantParts = [];
  /** callId → index into assistantParts, to fill outputs in on tool_result. */
  const toolPartIndex = new Map();
  /** Streaming text parts: `${seq}:${index}` → { partId, text } */
  const streamTexts = new Map();
  let streamSeq = 0;

  const model = (bridgeConfig.model ?? "").split("/").pop() || DEFAULT_MODEL;

  const emitToolUpdate = (callId, tool, state) => {
    broadcast("message.part.updated", {
      part: {
        type: "tool",
        sessionID: session.id,
        callID: callId,
        tool,
        state,
      },
    });
  };

  // Set the moment the model calls EnterPlanMode. From then on this turn is
  // read-only (see canUseTool) — the model's decision, enforced by the bridge.
  let planning = false;

  // Tell the model when planning is worth it. Only when the user allows it — with
  // the toggle off there is no EnterPlanMode tool and no guidance, so every
  // request executes straight away. The guidance rides on the prompt (a
  // systemPrompt append does not reliably reach the model here) but is kept OUT
  // of the recorded history: the visible message stays what the user typed.
  const sdkPrompt = planAllowed ? `${promptText}\n${PLANNING_GUIDANCE}` : promptText;

  try {
    const stream = query({
      prompt: sdkPrompt,
      options: {
        cwd: session.directory || process.cwd(),
        resume: session.claudeSessionId || undefined,
        model,
        // Always "default" so canUseTool is actually consulted: it implements the
        // approve/full switch itself (below), and a planning turn's read-only
        // enforcement lives there. Passing "bypassPermissions" to the SDK would
        // skip the callback entirely — and with it the enforcement, letting a
        // "planning" turn write files whenever the user is on full access.
        permissionMode: "default",
        includePartialMessages: true,
        // Load workspace settings (.claude/skills, CLAUDE.md) like the CLI does.
        settingSources: ["project"],
        abortController: abort,
        // EnterPlanMode + AskUserQuestion, served in-process (no subprocess).
        mcpServers: {
          apex: apexToolsFor(session, {
            planAllowed,
            onEnterPlan: () => {
              planning = true;
            },
          }),
        },
        ...(bridgeConfig.apiKey ? { env: { ...process.env, ANTHROPIC_API_KEY: bridgeConfig.apiKey } } : {}),
        canUseTool: async (toolName, input) => {
          if (toolName === "ExitPlanMode") {
            return {
              behavior: "deny",
              message:
                "Present the plan to the user as your final message and end the turn. Execution starts after the user confirms in their next message.",
            };
          }
          // Our own tools ask the user themselves — never gate them behind the
          // approval prompt (they must run even inside read-only planning).
          if (toolName.startsWith("mcp__apex__")) {
            return { behavior: "allow", updatedInput: input };
          }
          // The model opted into planning: research runs unprompted, and
          // anything that would execute is steered back into the plan.
          if (planning) {
            if (PLAN_READONLY_TOOLS.has(toolName)) return { behavior: "allow", updatedInput: input };
            return {
              behavior: "deny",
              message:
                "You are in plan mode — don't run this yet. Describe it in your plan, or ask the user a clarifying question with AskUserQuestion. Execution begins after the user confirms.",
            };
          }
          const mode = permissionMode();
          if (mode === "bypassPermissions") return { behavior: "allow", updatedInput: input };
          const allowed = alwaysAllowed.get(session.id);
          if (allowed?.has(toolName)) return { behavior: "allow", updatedInput: input };

          const requestId = freshId("perm");
          const permission = mapToolName(toolName);
          const patterns = permissionPatterns(toolName, input);
          broadcast("permission.asked", {
            id: requestId,
            sessionID: session.id,
            permission,
            patterns,
          });
          const reply = await new Promise((resolve) => {
            // action/patterns are kept so GET /permission (recovery on page
            // open) can re-render the prompt, not just the SSE event.
            pendingPermissions.set(requestId, { sessionId: session.id, permission, patterns, resolve });
          });
          broadcast("permission.replied", { requestID: requestId, sessionID: session.id });
          if (reply === "always") {
            if (!alwaysAllowed.has(session.id)) alwaysAllowed.set(session.id, new Set());
            alwaysAllowed.get(session.id).add(toolName);
          }
          return reply === "reject"
            ? { behavior: "deny", message: "The user declined this action." }
            : { behavior: "allow", updatedInput: input };
        },
      },
    });

    for await (const msg of stream) {
      // Subagent traffic (Task tool) renders through the parent tool row.
      if (msg.parent_tool_use_id) continue;

      if (msg.type === "system" && msg.subtype === "init") {
        session.claudeSessionId = msg.session_id;
        saveSessions();
        continue;
      }

      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (ev.type === "message_start") streamSeq++;
        if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
          const key = `${streamSeq}:${ev.index}`;
          const partId = freshId("prt");
          streamTexts.set(key, { partId, text: "" });
          broadcast("message.part.updated", {
            part: { type: "text", id: partId, sessionID: session.id, text: "" },
          });
        }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          const acc = streamTexts.get(`${streamSeq}:${ev.index}`);
          if (acc) {
            acc.text += ev.delta.text;
            broadcast("message.part.delta", { partID: acc.partId, field: "text", delta: ev.delta.text });
          }
        }
        continue;
      }

      if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "text" && block.text) {
            assistantParts.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            const tool = mapToolName(block.name);
            const input = mapToolInput(block.input);
            const state = {
              status: "running",
              title: toolTitle(block.name, block.input),
              input,
              time: { start: Date.now() },
            };
            toolPartIndex.set(block.id, assistantParts.length);
            assistantParts.push({ type: "tool", tool, callID: block.id, state: { ...state } });
            emitToolUpdate(block.id, tool, state);
          }
        }
        continue;
      }

      if (msg.type === "user") {
        const content = msg.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const idx = toolPartIndex.get(block.tool_use_id);
          if (idx === undefined) continue;
          const part = assistantParts[idx];
          const output = textOfContent(block.content);
          part.state = {
            ...part.state,
            status: block.is_error ? "error" : "completed",
            output,
            time: { ...part.state.time, end: Date.now() },
          };
          emitToolUpdate(part.callID, part.tool, part.state);
        }
        continue;
      }

      if (msg.type === "result") {
        if (msg.subtype !== "success" && msg.is_error) {
          const detail = typeof msg.result === "string" ? msg.result : msg.subtype;
          broadcast("session.error", { sessionID: session.id, error: { data: { message: detail } } });
        }
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      broadcast("session.error", {
        sessionID: session.id,
        error: { data: { message: err instanceof Error ? err.message : String(err) } },
      });
    }
  } finally {
    runningTurns.delete(session.id);
    // Any approval still pending belongs to a dead turn — deny and clear it.
    for (const [id, p] of pendingPermissions) {
      if (p.sessionId === session.id) {
        pendingPermissions.delete(id);
        p.resolve("reject");
      }
    }
    // Likewise any unanswered clarify question — resolve to null (skipped).
    for (const [id, q] of pendingQuestions) {
      if (q.sessionId === session.id) {
        pendingQuestions.delete(id);
        broadcast("question.rejected", { requestID: id, sessionID: session.id });
        q.resolve(null);
      }
    }
    // Streamed text that never made it into a complete assistant message
    // (interrupted turn) still belongs in history.
    const streamed = [...streamTexts.values()].map((t) => t.text).join("");
    const complete = assistantParts.some((p) => p.type === "text");
    if (assistantParts.length || streamed) {
      appendHistory(session.id, {
        info: { id: freshId("msg"), role: "assistant", time: { completed: Date.now() } },
        parts: complete || !streamed ? assistantParts : [...assistantParts, { type: "text", text: streamed }],
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
    execFile("/bin/sh", ["-c", command], { cwd: session.directory || process.cwd(), timeout: 120_000 }, (err, stdout, stderr) => {
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

// ---- workspace skills (.claude/skills/*/SKILL.md) ----
function listSkills(directory) {
  const out = [];
  if (!directory) return out;
  const dir = join(directory, ".claude", "skills");
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const text = readFileSync(skillMd, "utf8");
    const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
    out.push({ name: entry.name, description, location: skillMd });
  }
  return out;
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
      const session = { id, title: "Untitled", directory, claudeSessionId: null, createdAt: Date.now() };
      sessions.set(id, session);
      saveSessions();
      return void json(res, { id });
    }
    if (method === "GET" && (path === "/session" || path === "/experimental/session")) {
      const list = [...sessions.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => ({ id: s.id, title: s.title, directory: s.directory }));
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
        // `planMode: "auto"` = the user allows planning; the MODEL still decides
        // whether to use it. (`agent: "plan"` is OpenCode's force-a-plan-agent
        // routing — honored here as "planning allowed" for compatibility.)
        const planAllowed = body.planMode === "auto" || body.agent === "plan";
        void runTurn(session, text, { planAllowed });
        return void json(res, { ok: true });
      }
      if (method === "POST" && sub === "abort") {
        const turn = runningTurns.get(id);
        if (turn) turn.abort.abort();
        return void json(res, Boolean(turn));
      }
      if (method === "POST" && sub === "shell") {
        const body = await readBody(req);
        if (typeof body.command !== "string" || !body.command.trim())
          return void apiError(res, 400, "missing command");
        await runShell(session, body.command);
        return void json(res, { ok: true });
      }
      if (method === "POST" && sub === "command") {
        const body = await readBody(req);
        const text = `/${body.command}${body.arguments ? ` ${body.arguments}` : ""}`;
        if (runningTurns.has(id)) return void apiError(res, 409, "a turn is already running");
        void runTurn(session, text);
        return void json(res, { ok: true });
      }
      return void notFound(res);
    }

    // --- config / providers ---
    if (method === "GET" && path === "/config") return void json(res, { model: bridgeConfig.model ?? null });
    if (path === "/global/config") {
      if (method === "GET") return void json(res, { model: bridgeConfig.model, provider: {}, mcp: {} });
      if (method === "PATCH") {
        const body = await readBody(req);
        if (typeof body.model === "string") bridgeConfig.model = body.model;
        saveConfig();
        return void json(res, { ok: true });
      }
    }
    if (method === "GET" && path === "/config/providers") {
      return void json(res, {
        providers: [{ id: "anthropic", name: "Claude (Agent SDK)", models: MODELS }],
      });
    }
    if (method === "GET" && path === "/provider") {
      return void json(res, {
        all: [{ id: "anthropic", name: "Claude (Agent SDK)", env: ["ANTHROPIC_API_KEY"] }],
        connected: ["anthropic"],
      });
    }
    if (method === "GET" && path === "/provider/auth") {
      return void json(res, { anthropic: [{ type: "api", label: "API key" }] });
    }
    const authMatch = /^\/auth\/([^/]+)$/.exec(path);
    if (authMatch) {
      if (method === "PUT") {
        const body = await readBody(req);
        if (typeof body.key === "string") bridgeConfig.apiKey = body.key;
        saveConfig();
        return void json(res, { ok: true });
      }
      if (method === "DELETE") {
        delete bridgeConfig.apiKey;
        saveConfig();
        return void json(res, { ok: true });
      }
    }

    // --- interactive requests ---
    if (method === "GET" && path === "/permission") {
      const pend = [...pendingPermissions.entries()].map(([rid, p]) => ({
        id: rid,
        sessionID: p.sessionId,
        permission: p.permission ?? "tool",
        patterns: p.patterns ?? [],
      }));
      return void json(res, pend);
    }
    const permReply = /^\/permission\/([^/]+)\/reply$/.exec(path);
    if (method === "POST" && permReply) {
      const rid = decodeURIComponent(permReply[1]);
      const pending = pendingPermissions.get(rid);
      if (!pending) return void apiError(res, 404, "no such permission request");
      const body = await readBody(req);
      pendingPermissions.delete(rid);
      pending.resolve(body.reply === "reject" ? "reject" : body.reply === "always" ? "always" : "once");
      return void json(res, { ok: true });
    }
    if (method === "GET" && path === "/question") {
      // Recovery on page open: pending clarify questions the agent is blocked on.
      const pend = [...pendingQuestions.entries()].map(([rid, q]) => ({
        id: rid,
        sessionID: q.sessionId,
        questions: q.questions,
      }));
      return void json(res, pend);
    }
    const qReply = /^\/question\/([^/]+)\/reply$/.exec(path);
    if (method === "POST" && qReply) {
      const rid = decodeURIComponent(qReply[1]);
      const pending = pendingQuestions.get(rid);
      if (!pending) return void apiError(res, 404, "no such question");
      const body = await readBody(req);
      pendingQuestions.delete(rid);
      broadcast("question.replied", { requestID: rid, sessionID: pending.sessionId });
      pending.resolve(Array.isArray(body.answers) ? body.answers : []);
      return void json(res, { ok: true });
    }
    const qReject = /^\/question\/([^/]+)\/reject$/.exec(path);
    if (method === "POST" && qReject) {
      const rid = decodeURIComponent(qReject[1]);
      const pending = pendingQuestions.get(rid);
      if (!pending) return void apiError(res, 404, "no such question");
      pendingQuestions.delete(rid);
      broadcast("question.rejected", { requestID: rid, sessionID: pending.sessionId });
      pending.resolve(null);
      return void json(res, { ok: true });
    }

    // --- discovery stubs the UI polls ---
    if (method === "GET" && path === "/api/skill") {
      return void json(res, { data: listSkills(url.searchParams.get("directory")) });
    }
    if (method === "GET" && path === "/agent") return void json(res, []);
    if (method === "GET" && path === "/command") return void json(res, []);
    if (method === "GET" && path === "/mcp") return void json(res, {});
    if (method === "POST" && path === "/instance/dispose") return void json(res, { ok: true });

    notFound(res);
  } catch (err) {
    apiError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

server.listen(PORT, HOSTNAME, () => {
  console.error(`claude-bridge listening on http://${HOSTNAME}:${PORT} (agent: Claude Agent SDK)`);
});
