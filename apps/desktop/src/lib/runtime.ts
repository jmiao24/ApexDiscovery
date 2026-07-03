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
import type { RuntimeStatus, ThreadBlock } from "@ai4s/shared";
import { isTauri, startRuntime } from "./tauri";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const URL_KEY = "ai4s.opencodeUrl";

function initialUrl(): string {
  if (typeof window === "undefined") return DEFAULT_OPENCODE_URL;
  return window.localStorage.getItem(URL_KEY) ?? DEFAULT_OPENCODE_URL;
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
  error: string | null;
  setServerUrl: (url: string) => void;
  loadCatalog: () => Promise<void>;
  connect: () => Promise<void>;
  connectRetry: (tries?: number) => Promise<void>;
  bootstrap: () => Promise<void>;
  disconnect: () => void;
  refreshSessions: () => Promise<void>;
  newSession: () => Promise<string | null>;
  openSession: (id: string) => Promise<void>;
  sendPrompt: (text: string) => Promise<void>;
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
  error: null,

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

  connect: async () => {
    get().disconnect();
    const c = new OpenCodeClient({ baseUrl: get().serverUrl });
    client = c;
    c.onStatus((status) => set({ status }));
    c.onEvent((event) => {
      if (event.type === "error") {
        set({ error: event.message });
        return;
      }
      const sid = event.sessionId;
      if (!sid) return;
      set((s) => {
        const cur = s.threads[sid] ?? emptyThread();
        const folded = foldEvent({ blocks: cur.blocks, index: cur.index }, event);
        return {
          threads: { ...s.threads, [sid]: { ...cur, ...folded, loaded: true } },
        };
      });
      if (event.type === "session.idle") void get().refreshSessions();
    });
    try {
      await c.connect();
      set({ error: null });
      await get().refreshSessions();
      await get().loadCatalog();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), status: "error" });
    }
  },

  connectRetry: async (tries = 12) => {
    for (let i = 0; i < tries; i++) {
      await get().connect();
      if (get().status === "ready") return;
      await sleep(500);
    }
  },

  bootstrap: async () => {
    if (!isTauri) return;
    try {
      const url = await startRuntime();
      if (url) set({ serverUrl: url });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
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
      const sessions = await client.listSessions();
      set({ sessions });
    } catch {
      /* ignore transient list failures */
    }
  },

  newSession: async () => {
    if (!client) {
      set({ error: "Not connected to the OpenCode runtime." });
      return null;
    }
    try {
      const id = await client.createSession();
      set((s) => ({
        threads: { ...s.threads, [id]: { ...emptyThread(), loaded: true } },
        currentId: id,
      }));
      await get().refreshSessions();
      return id;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  openSession: async (id) => {
    set({ currentId: id });
    const existing = get().threads[id];
    if (existing?.loaded) return;
    if (!client) return;
    try {
      const messages = await client.getMessages(id);
      set((s) => ({
        threads: { ...s.threads, [id]: { ...historyToThread(messages), loaded: true } },
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  sendPrompt: async (text) => {
    const id = get().currentId;
    if (!id) {
      set({ error: "No active session." });
      return;
    }
    set((s) => {
      const cur = s.threads[id] ?? emptyThread();
      return {
        threads: {
          ...s.threads,
          [id]: { ...cur, loaded: true, blocks: [...cur.blocks, { kind: "user", text }] },
        },
      };
    });
    if (!client) {
      set({ error: "Not connected to the OpenCode runtime." });
      return;
    }
    try {
      await client.sendPrompt(id, text);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
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
      const block: ThreadBlock = {
        kind: "tool-call",
        title: event.title ?? event.tool,
        status: event.status,
      };
      if (key in index) blocks[index[key]] = block;
      else {
        blocks.push(block);
        index[key] = blocks.length - 1;
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
          blocks.push({ kind: "agent", markdown: p.text });
        } else if (p.type === "tool") {
          blocks.push({
            kind: "tool-call",
            title: p.state?.title ?? p.tool ?? "tool",
            status: mapToolStatus(p.state?.status),
          });
        }
      }
    }
  }
  return { blocks, index: {} };
}
