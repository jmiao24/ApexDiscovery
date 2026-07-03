import { create } from "zustand";
import {
  OpenCodeClient,
  DEFAULT_OPENCODE_URL,
  type AgentInfo,
  type HistoryMessage,
  type OpenCodeEvent,
  type SessionMeta,
  type SkillInfo,
  type ToolCallStatus,
} from "@ai4s/sdk";
import type { ArtifactBlock, RuntimeStatus, ThreadBlock } from "@ai4s/shared";
import { detectTools as probeTools, isTauri, logDebug, startRuntime, type ToolStatus } from "./tauri";
import { deriveArtifact } from "./artifacts";

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
  tools: ToolStatus[];
  hiddenExamples: string[];
  error: string | null;
  /** Artifact opened in the live inspector pane, if any. */
  activeArtifact: ArtifactBlock | null;
  openArtifact: (a: ArtifactBlock) => void;
  closeArtifact: () => void;
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

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  status: "offline",
  serverUrl: initialUrl(),
  sessions: [],
  currentId: null,
  threads: {},
  skills: [],
  agents: [],
  tools: [],
  hiddenExamples: initialHidden(),
  error: null,
  activeArtifact: null,

  openArtifact: (activeArtifact) => set({ activeArtifact }),
  closeArtifact: () => set({ activeArtifact: null }),

  setServerUrl: (serverUrl) => {
    if (typeof window !== "undefined") window.localStorage.setItem(URL_KEY, serverUrl);
    set({ serverUrl });
  },

  loadCatalog: async () => {
    if (!client) return;
    try {
      const [skills, agents] = await Promise.all([client.listSkills(), client.listAgents()]);
      set({ skills, agents });
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
    const c = new OpenCodeClient({ baseUrl: get().serverUrl });
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
      const sid = event.sessionId;
      if (!sid) return;
      set((s) => {
        const cur = s.threads[sid] ?? emptyThread();
        const folded = foldEvent({ blocks: cur.blocks, index: cur.index }, event);
        return { threads: { ...s.threads, [sid]: { ...cur, ...folded, loaded: true } } };
      });
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

  connectRetry: async (tries = 30) => {
    set({ status: "connecting" });
    for (let i = 0; i < tries; i++) {
      await get().connect();
      if (get().status === "ready") return;
      set({ status: "connecting" }); // mask transient failures while the sidecar boots
      await sleep(500);
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
    if (get().threads[id]?.loaded) return;
    if (!client) return;
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
        "a skill file under .opencode/skill/. Then reply with the installed skill's name.\n\n---\n" +
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
export function foldEvent(state: FoldState, event: OpenCodeEvent): FoldState {
  const blocks = [...state.blocks];
  const index = { ...state.index };
  switch (event.type) {
    case "text.updated": {
      const key = `text:${event.partId}`;
      if (key in index) blocks[index[key]] = { kind: "agent", markdown: event.text };
      else {
        blocks.push({ kind: "agent", markdown: event.text });
        index[key] = blocks.length - 1;
      }
      return { blocks, index };
    }
    case "tool.updated": {
      const key = `tool:${event.callId}`;
      const block: ThreadBlock = { kind: "tool-call", title: event.title ?? event.tool, status: event.status };
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
        if (p.type === "text" && p.text?.trim()) blocks.push({ kind: "agent", markdown: p.text });
        else if (p.type === "tool") {
          const status = mapToolStatus(p.state?.status);
          blocks.push({ kind: "tool-call", title: p.state?.title ?? p.tool ?? "tool", status });
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
