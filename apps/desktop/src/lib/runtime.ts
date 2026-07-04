import { create } from "zustand";
import {
  OpenCodeClient,
  DEFAULT_OPENCODE_URL,
  type AgentInfo,
  type HistoryMessage,
  type OpenCodeEvent,
  type PermissionAskedEvent,
  type PermissionReply,
  type QuestionAskedEvent,
  type SessionMeta,
  type SkillInfo,
  type ToolCallStatus,
} from "@ai4s/sdk";
import type { ArtifactBlock, RuntimeStatus, ThreadBlock } from "@ai4s/shared";
import {
  detectTools as probeTools,
  isTauri,
  logDebug,
  startRuntime,
  workspacePath,
  type ToolStatus,
} from "./tauri";
import { deriveArtifact } from "./artifacts";
import { provenanceInputFromEvent, recordProvenance } from "./provenance";
import { splitReview } from "./review";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const URL_KEY = "ai4s.opencodeUrl";
const HIDDEN_KEY = "ai4s.hiddenExamples";

function initialUrl(): string {
  if (typeof window === "undefined") return DEFAULT_OPENCODE_URL;
  return window.localStorage.getItem(URL_KEY) ?? DEFAULT_OPENCODE_URL;
}
function initialHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export interface Thread {
  blocks: ThreadBlock[];
  index: Record<string, number>;
  loaded: boolean;
}

interface RuntimeState {
  status: RuntimeStatus;
  serverUrl: string;
  sessions: SessionMeta[];
  currentId: string | null;
  threads: Record<string, Thread>;
  skills: SkillInfo[];
  agents: AgentInfo[];
  /** Configured default model ("provider/model"), or null when unset. */
  defaultModel: string | null;
  tools: ToolStatus[];
  hiddenExamples: string[];
  error: string | null;
  /** Pending interactive requests the agent is blocked on, newest last. */
  questions: QuestionAskedEvent[];
  permissions: PermissionAskedEvent[];
  /** Artifact opened in the live inspector pane, if any. */
  activeArtifact: ArtifactBlock | null;
  openArtifact: (a: ArtifactBlock) => void;
  closeArtifact: () => void;
  answerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
  replyPermission: (requestId: string, reply: PermissionReply) => Promise<void>;
  setServerUrl: (url: string) => void;
  loadCatalog: () => Promise<void>;
  detectTools: () => Promise<void>;
  connect: () => Promise<void>;
  connectRetry: (tries?: number) => Promise<void>;
  bootstrap: () => Promise<void>;
  disconnect: () => void;
  refreshSessions: () => Promise<void>;
  startDraft: () => void;
  openSession: (id: string) => Promise<void>;
  sendPrompt: (text: string) => Promise<string | null>;
  deleteSession: (id: string) => Promise<void>;
  hideExample: (id: string) => void;
  installSkill: (text: string) => Promise<string | null>;
}

let client: OpenCodeClient | null = null;
const emptyThread = (): Thread => ({ blocks: [], index: {}, loaded: false });
/** Tool calls already written to provenance — success events can repeat per callId. */
const recordedProvenance = new Set<string>();

/** The live OpenCode client (Settings talks to the runtime's config API directly). */
export function getClient(): OpenCodeClient | null {
  return client;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  status: "offline",
  serverUrl: initialUrl(),
  sessions: [],
  currentId: null,
  threads: {},
  skills: [],
  agents: [],
  defaultModel: null,
  tools: [],
  hiddenExamples: initialHidden(),
  error: null,
  questions: [],
  permissions: [],
  activeArtifact: null,

  openArtifact: (activeArtifact) => set({ activeArtifact }),
  closeArtifact: () => set({ activeArtifact: null }),

  answerQuestion: async (requestId, answers) => {
    const q = get().questions.find((x) => x.requestId === requestId);
    if (!q || !client) return;
    set((s) => ({ questions: s.questions.filter((x) => x.requestId !== requestId) }));
    try {
      await client.answerQuestion(requestId, answers);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  rejectQuestion: async (requestId) => {
    const q = get().questions.find((x) => x.requestId === requestId);
    if (!q || !client) return;
    set((s) => ({ questions: s.questions.filter((x) => x.requestId !== requestId) }));
    try {
      await client.rejectQuestion(requestId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  replyPermission: async (requestId, reply) => {
    const p = get().permissions.find((x) => x.requestId === requestId);
    if (!p || !client) return;
    set((s) => ({ permissions: s.permissions.filter((x) => x.requestId !== requestId) }));
    try {
      await client.replyPermission(requestId, reply);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setServerUrl: (serverUrl) => {
    if (typeof window !== "undefined") window.localStorage.setItem(URL_KEY, serverUrl);
    set({ serverUrl });
  },

  loadCatalog: async () => {
    if (!client) return;
    try {
      const [firstSkills, agents, defaultModel] = await Promise.all([
        client.listSkills(),
        client.listAgents(),
        client.getDefaultModel().catch(() => null),
      ]);
      let skills = firstSkills;
      // The first workspace-scoped /api/skill call triggers OpenCode's lazy
      // instance init and can answer before the scan finishes — retry once.
      if (skills.length === 0) {
        await sleep(1500);
        skills = await client.listSkills();
      }
      set({ skills, agents, defaultModel });
    } catch {
      /* ignore transient failures */
    }
  },

  detectTools: async () => {
    try {
      set({ tools: await probeTools() });
    } catch {
      /* ignore */
    }
  },

  connect: async () => {
    get().disconnect();
    // Scope skill discovery to the sidecar's workspace (null in browser dev).
    const directory = await workspacePath();
    const c = new OpenCodeClient({ baseUrl: get().serverUrl, directory: directory ?? undefined });
    client = c;
    c.onStatus((status) => {
      void logDebug(`status → ${status}`);
      set({ status });
    });
    c.onEvent((event) => {
      void logDebug(`event ← ${event.type}${"sessionId" in event ? " " + event.sessionId : ""}`);
      if (event.type === "error") {
        set({ error: event.message });
        return;
      }
      // Interactive requests live outside the thread blocks (transient UI).
      switch (event.type) {
        case "question.asked":
          set((s) => ({
            questions: [...s.questions.filter((q) => q.requestId !== event.requestId), event],
          }));
          return;
        case "question.resolved":
          set((s) => ({ questions: s.questions.filter((q) => q.requestId !== event.requestId) }));
          return;
        case "permission.asked":
          set((s) => ({
            permissions: [
              ...s.permissions.filter((p) => p.requestId !== event.requestId),
              event,
            ],
          }));
          return;
        case "permission.resolved":
          set((s) => ({ permissions: s.permissions.filter((p) => p.requestId !== event.requestId) }));
          return;
      }
      const sid = event.sessionId;
      if (!sid) return;
      set((s) => {
        const cur = s.threads[sid] ?? emptyThread();
        const folded = foldEvent({ blocks: cur.blocks, index: cur.index }, event);
        return { threads: { ...s.threads, [sid]: { ...cur, ...folded, loaded: true } } };
      });
      // A completed live write becomes a provenance version (once per call).
      if (event.type === "tool.updated" && !recordedProvenance.has(event.callId)) {
        const input = provenanceInputFromEvent(event);
        if (input) {
          recordedProvenance.add(event.callId);
          void recordProvenance(input, sid, get().defaultModel);
        }
      }
      if (event.type === "session.idle") void get().refreshSessions();
    });
    try {
      void logDebug(`connect → ${get().serverUrl}`);
      await c.connect();
      void logDebug("connect OK");
      set({ error: null });
      await get().refreshSessions();
      await get().loadCatalog();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void logDebug(`connect FAILED: ${msg}`);
      set({ error: msg, status: "error" });
    }
  },

  // First boot can be slow far beyond the process spawn: on a fresh install
  // macOS TCC ("access Documents") blocks the sidecar until the user answers,
  // so the window must cover minutes, not seconds — giving up early strands
  // the user on an error screen that a single manual Connect would fix.
  connectRetry: async (tries = 120) => {
    set({ status: "connecting" });
    for (let i = 0; i < tries; i++) {
      await get().connect();
      if (get().status === "ready") return;
      set({ status: "connecting" }); // mask transient failures while the sidecar boots
      await sleep(1000);
    }
    set({ status: "error" });
  },

  bootstrap: async () => {
    void get().detectTools();
    if (!isTauri) return;
    void logDebug("bootstrap: starting bundled runtime");
    try {
      const url = await startRuntime();
      void logDebug(`bootstrap: runtime at ${url}`);
      if (url) set({ serverUrl: url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void logDebug(`bootstrap FAILED: ${msg}`);
      set({ error: msg });
      return;
    }
    await get().connectRetry();
  },

  disconnect: () => {
    client?.close();
    client = null;
    set({ status: "offline" });
  },

  refreshSessions: async () => {
    if (!client) return;
    try {
      set({ sessions: await client.listSessions() });
    } catch {
      /* ignore transient list failures */
    }
  },

  // "New" opens a blank draft — no session is created until the first message (#3).
  startDraft: () => set({ currentId: null }),

  openSession: async (id) => {
    set({ currentId: id });
    if (!client) return;
    // Recover any request the agent is blocked on (asked before connect/reload).
    void (async () => {
      try {
        const [qs, ps] = await Promise.all([
          client!.listQuestions(id),
          client!.listPermissions(id),
        ]);
        set((s) => ({
          questions: [...s.questions.filter((q) => q.sessionId !== id), ...qs],
          permissions: [...s.permissions.filter((p) => p.sessionId !== id), ...ps],
        }));
      } catch {
        /* pending-request recovery is best-effort */
      }
    })();
    if (get().threads[id]?.loaded) return;
    try {
      const messages = await client.getMessages(id);
      set((s) => ({ threads: { ...s.threads, [id]: { ...historyToThread(messages), loaded: true } } }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  sendPrompt: async (text) => {
    if (!client) {
      set({ error: "Not connected to the OpenCode runtime." });
      return null;
    }
    let id = get().currentId;
    if (!id) {
      // Lazy-create the session on the first message (#3).
      try {
        id = await client.createSession();
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return null;
      }
      set((s) => ({
        currentId: id,
        threads: { ...s.threads, [id!]: { ...emptyThread(), loaded: true } },
      }));
      void get().refreshSessions();
    }
    const sid = id;
    set((s) => {
      const cur = s.threads[sid] ?? emptyThread();
      return {
        threads: { ...s.threads, [sid]: { ...cur, loaded: true, blocks: [...cur.blocks, { kind: "user", text }] } },
      };
    });
    try {
      void logDebug(`sendPrompt → ${sid}`);
      await client.sendPrompt(sid, text);
      void logDebug("sendPrompt OK");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void logDebug(`sendPrompt FAILED: ${msg}`);
      set({ error: msg });
    }
    return sid;
  },

  deleteSession: async (id) => {
    if (client) {
      try {
        await client.deleteSession(id);
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    }
    set((s) => {
      const threads = { ...s.threads };
      delete threads[id];
      return {
        sessions: s.sessions.filter((x) => x.id !== id),
        threads,
        currentId: s.currentId === id ? null : s.currentId,
      };
    });
  },

  hideExample: (id) => {
    const next = Array.from(new Set([...get().hiddenExamples, id]));
    if (typeof window !== "undefined") window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    set({ hiddenExamples: next });
  },

  // Install a skill by asking the agent (uses OpenCode's customize-opencode skill) (#1).
  installSkill: async (text) => {
    if (!client) {
      set({ error: "Connect the runtime first to install skills." });
      return null;
    }
    try {
      const id = await client.createSession();
      set((s) => ({ currentId: id, threads: { ...s.threads, [id]: { ...emptyThread(), loaded: true } } }));
      await get().refreshSessions();
      const prompt =
        "Install the following as an OpenCode skill for this project. Use the " +
        "customize-opencode skill. If it is a URL, fetch it; if it is Markdown, save it as " +
        "a skill file under .opencode/skills/<name>/SKILL.md. Then reply with the installed skill's name.\n\n---\n" +
        text;
      set((s) => {
        const cur = s.threads[id];
        return {
          threads: {
            ...s.threads,
            [id]: { ...cur, blocks: [...cur.blocks, { kind: "user", text: `Install skill:\n${text}` }] },
          },
        };
      });
      await client.sendPrompt(id, prompt);
      return id;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },
}));

export interface FoldState {
  blocks: ThreadBlock[];
  index: Record<string, number>;
}

/** Pure reducer: fold one normalized OpenCode event into a thread's blocks. */
/**
 * Tidy a tool-call title for the conversation: show workspace files by their
 * relative path (`demo/analyze.py`), not the full `/Users/.../OpenScience/...`
 * absolute path, so the thread reads like a researcher's log, not a shell trace.
 * The workspace path never contains spaces (by design), so a space-free run
 * ending in `OpenScience/` matches it whether or not it has a leading slash
 * (OpenCode's write-tool titles drop it).
 */
export function tidyToolTitle(title: string): string {
  return title.replace(/[^\s]*OpenScience\//g, "").trim() || title;
}

export function foldEvent(state: FoldState, event: OpenCodeEvent): FoldState {
  const blocks = [...state.blocks];
  const index = { ...state.index };
  switch (event.type) {
    case "text.updated": {
      // A ```review fence in the agent's text becomes a structured reviewer card.
      const { clean, review } = splitReview(event.text);
      const key = `text:${event.partId}`;
      if (key in index) blocks[index[key]] = { kind: "agent", markdown: clean };
      else {
        blocks.push({ kind: "agent", markdown: clean });
        index[key] = blocks.length - 1;
      }
      if (review) {
        const rkey = `review:${event.partId}`;
        if (rkey in index) blocks[index[rkey]] = review;
        else {
          blocks.push(review);
          index[rkey] = blocks.length - 1;
        }
      }
      return { blocks, index };
    }
    case "tool.updated": {
      // The interactive `question`/`permission` tools render as their own
      // answerable card (InteractionPrompt), not as a blank thread row.
      if (/question|permission|^ask$/i.test(event.tool)) return { blocks, index };
      const key = `tool:${event.callId}`;
      // Completed MCP tools report title as "" — fall back to the tool name,
      // never render a blank row.
      const block: ThreadBlock = {
        kind: "tool-call",
        title: tidyToolTitle(event.title?.trim() || event.tool || "tool"),
        status: event.status,
      };
      if (key in index) blocks[index[key]] = block;
      else {
        blocks.push(block);
        index[key] = blocks.length - 1;
      }
      // Surface a file the agent wrote as a traceable artifact (deduped by path).
      const artifact = deriveArtifact(event);
      if (artifact) {
        const akey = `artifact:${artifact.path}`;
        if (akey in index) blocks[index[akey]] = artifact;
        else {
          blocks.push(artifact);
          index[akey] = blocks.length - 1;
        }
      }
      return { blocks, index };
    }
    case "session.idle":
      blocks.push({ kind: "status-line", text: "done", tone: "done" });
      return { blocks, index };
    default:
      return state;
  }
}

function mapToolStatus(status?: string): ToolCallStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "error":
      return "failed";
    default:
      return "pending";
  }
}

/** Convert loaded message history into thread blocks. */
export function historyToThread(messages: HistoryMessage[]): FoldState {
  const blocks: ThreadBlock[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (text) blocks.push({ kind: "user", text });
    } else {
      for (const p of m.parts) {
        if (p.type === "text" && p.text?.trim()) {
          const { clean, review } = splitReview(p.text);
          if (clean) blocks.push({ kind: "agent", markdown: clean });
          if (review) blocks.push(review);
        }
        else if (p.type === "tool") {
          // Interactive tools are surfaced by InteractionPrompt, not the thread.
          if (/question|permission|^ask$/i.test(p.tool ?? "")) continue;
          const status = mapToolStatus(p.state?.status);
          blocks.push({
            kind: "tool-call",
            title: tidyToolTitle(p.state?.title?.trim() || p.tool || "tool"),
            status,
          });
          const artifact = deriveArtifact({
            type: "tool.updated",
            sessionId: "",
            callId: "",
            tool: p.tool ?? "",
            status,
            input: p.state?.input,
            output: p.state?.output,
          });
          if (artifact) blocks.push(artifact);
        }
      }
    }
  }
  return { blocks, index: {} };
}
