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
// - Auth: uses the machine's `codex login` (~/.codex/auth.json) or
//   OPENAI_API_KEY. The SDK vendors its own codex binary.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex } from "@openai/codex-sdk";

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
const STORE_DIR = join(DATA_HOME, "codex-bridge");
const HISTORY_DIR = join(STORE_DIR, "history");
mkdirSync(HISTORY_DIR, { recursive: true });

// The user's ~/.codex/config.toml is the source of truth for the default
// model (hardcoding one breaks whenever Codex ships new models — the bridge
// only overrides when the user picks a model in Settings).
function codexDefaultModel() {
  try {
    const toml = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
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

const codex = new Codex();

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
const bridgeConfig = readJson(configPath, { model: "openai/default" });
const saveConfig = () => writeJson(configPath, bridgeConfig);

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
async function runTurn(session, promptText) {
  if (runningTurns.has(session.id)) throw Object.assign(new Error("A turn is already running"), { status: 409 });

  appendHistory(session.id, {
    info: { id: freshId("msg"), role: "user", time: { completed: Date.now() } },
    parts: [{ type: "text", text: promptText }],
  });
  if (!session.title || session.title === "Untitled") {
    session.title = promptText.slice(0, 60).replace(/\s+/g, " ").trim() || "Untitled";
    saveSessions();
  }

  const turn = { aborted: false, close: () => {} };
  runningTurns.set(session.id, turn);

  // Assembled as the turn progresses; flushed to history at the end.
  const assistantParts = [];
  /** codex item id → index into assistantParts (running tools awaiting completion). */
  const itemIndex = new Map();

  // "default" (or unset) leaves the model to ~/.codex/config.toml.
  const chosen = (bridgeConfig.model ?? "").split("/").pop();
  const threadOptions = {
    workingDirectory: session.directory || process.cwd(),
    ...(chosen && chosen !== "default" ? { model: chosen } : {}),
    sandboxMode: sandboxMode(),
    skipGitRepoCheck: true,
  };

  const emitToolUpdate = (callId, tool, state) => {
    broadcast("message.part.updated", {
      part: { type: "tool", sessionID: session.id, callID: callId, tool, state },
    });
  };
  const emitText = (partId, text) => {
    broadcast("message.part.updated", {
      part: { type: "text", id: partId, sessionID: session.id, text },
    });
  };

  try {
    const thread = session.codexThreadId
      ? codex.resumeThread(session.codexThreadId, threadOptions)
      : codex.startThread(threadOptions);

    const { events } = await thread.runStreamed(promptText);
    turn.close = () => void events.return?.();

    for await (const event of events) {
      if (turn.aborted) break;

      if (event.type === "thread.started") {
        session.codexThreadId = event.thread_id;
        saveSessions();
        continue;
      }

      if (event.type === "turn.failed") {
        const message = event.error?.message ?? "turn failed";
        broadcast("session.error", { sessionID: session.id, error: { data: { message } } });
        continue;
      }
      if (event.type === "error") {
        broadcast("session.error", {
          sessionID: session.id,
          error: { data: { message: event.message ?? "runtime error" } },
        });
        continue;
      }

      if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed")
        continue;
      const item = event.item;
      if (!item) continue;

      switch (item.type) {
        case "agent_message": {
          // Full-text updates keyed by the item id — the client upserts by
          // partId, so re-sending the whole text streams cleanly.
          const partId = `prt_${item.id}`;
          emitText(partId, item.text ?? "");
          if (event.type === "item.completed" && item.text) {
            assistantParts.push({ type: "text", text: item.text });
          }
          break;
        }
        case "command_execution": {
          const callId = `cll_${item.id}`;
          const running = event.type !== "item.completed";
          const state = {
            status: running ? "running" : item.status === "failed" ? "error" : "completed",
            title: item.command,
            input: { command: item.command },
            output: running ? undefined : item.aggregated_output ?? "",
            time: running ? { start: Date.now() } : undefined,
          };
          if (running && !itemIndex.has(item.id)) {
            itemIndex.set(item.id, assistantParts.length);
            assistantParts.push({ type: "tool", tool: "bash", callID: callId, state: { ...state, time: { start: Date.now() } } });
          } else if (!running) {
            const idx = itemIndex.get(item.id);
            const started = idx !== undefined ? assistantParts[idx].state.time?.start : undefined;
            const done = { ...state, time: { start: started ?? Date.now(), end: Date.now() } };
            if (idx !== undefined) assistantParts[idx].state = done;
            else assistantParts.push({ type: "tool", tool: "bash", callID: callId, state: done });
            emitToolUpdate(callId, "bash", done);
            break;
          }
          emitToolUpdate(callId, "bash", assistantParts[itemIndex.get(item.id)]?.state ?? state);
          break;
        }
        case "file_change": {
          // Codex reports batched file changes; surface one tool row per file.
          if (event.type !== "item.completed") break;
          for (const change of item.changes ?? []) {
            const tool = textOfChangeKind(change.kind);
            const callId = `cll_${item.id}_${change.path}`;
            const state = {
              status: item.status === "failed" ? "error" : "completed",
              title: change.path,
              input: { filePath: change.path },
              time: { start: Date.now(), end: Date.now() },
            };
            assistantParts.push({ type: "tool", tool, callID: callId, state });
            emitToolUpdate(callId, tool, state);
          }
          break;
        }
        case "mcp_tool_call": {
          if (event.type !== "item.completed") break;
          const callId = `cll_${item.id}`;
          const state = {
            status: item.status === "failed" ? "error" : "completed",
            title: `${item.server}.${item.tool}`,
            input: {},
            time: { start: Date.now(), end: Date.now() },
          };
          assistantParts.push({ type: "tool", tool: "mcp", callID: callId, state });
          emitToolUpdate(callId, "mcp", state);
          break;
        }
        case "web_search": {
          if (event.type !== "item.completed") break;
          const callId = `cll_${item.id}`;
          const state = {
            status: "completed",
            title: item.query ?? "web search",
            input: { pattern: item.query },
            time: { start: Date.now(), end: Date.now() },
          };
          assistantParts.push({ type: "tool", tool: "websearch", callID: callId, state });
          emitToolUpdate(callId, "websearch", state);
          break;
        }
        case "error": {
          broadcast("session.error", {
            sessionID: session.id,
            error: { data: { message: item.message ?? "agent error" } },
          });
          break;
        }
        default:
          break; // reasoning / todo_list are not rendered
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

// ---- workspace skills (informational only — Codex uses AGENTS.md natively) ----
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
      const session = { id, title: "Untitled", directory, codexThreadId: null, createdAt: Date.now() };
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
        // body.agent (plan routing) is deliberately ignored on the Codex backend.
        void runTurn(session, text);
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
          bridgeConfig.apiKey = body.key;
          process.env.OPENAI_API_KEY = body.key;
        }
        saveConfig();
        return void json(res, { ok: true });
      }
      if (method === "DELETE") {
        delete bridgeConfig.apiKey;
        saveConfig();
        return void json(res, { ok: true });
      }
    }

    // --- interactive requests: Codex uses sandboxing, not per-tool approvals ---
    if (method === "GET" && path === "/permission") return void json(res, []);
    if (method === "GET" && path === "/question") return void json(res, []);

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
  console.error(`codex-bridge listening on http://${HOSTNAME}:${PORT} (agent: OpenAI Codex SDK)`);
});
