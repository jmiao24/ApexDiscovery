import { create } from "zustand";
import { OpenCodeClient, DEFAULT_OPENCODE_URL, type OpenCodeEvent } from "@ai4s/sdk";
import type { RuntimeStatus, ThreadBlock } from "@ai4s/shared";

const URL_KEY = "ai4s.opencodeUrl";

function initialUrl(): string {
  if (typeof window === "undefined") return DEFAULT_OPENCODE_URL;
  return window.localStorage.getItem(URL_KEY) ?? DEFAULT_OPENCODE_URL;
}

interface RuntimeState {
  status: RuntimeStatus;
  serverUrl: string;
  sessionId: string | null;
  blocks: ThreadBlock[];
  index: Record<string, number>;
  error: string | null;
  setServerUrl: (url: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendPrompt: (text: string) => Promise<void>;
}

// The client lives outside the store (it is not serializable state).
let client: OpenCodeClient | null = null;

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  status: "offline",
  serverUrl: initialUrl(),
  sessionId: null,
  blocks: [],
  index: {},
  error: null,

  setServerUrl: (serverUrl) => {
    if (typeof window !== "undefined") window.localStorage.setItem(URL_KEY, serverUrl);
    set({ serverUrl });
  },

  connect: async () => {
    get().disconnect();
    const c = new OpenCodeClient({ baseUrl: get().serverUrl });
    client = c;
    c.onStatus((status) => set({ status }));
    c.onEvent((event) =>
      set((s) => {
        if (event.type === "error") return { error: event.message };
        const folded = foldEvent({ blocks: s.blocks, index: s.index }, event);
        return { blocks: folded.blocks, index: folded.index };
      }),
    );
    try {
      await c.connect();
      const sessionId = await c.createSession();
      set({ sessionId, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), status: "error" });
    }
  },

  disconnect: () => {
    client?.close();
    client = null;
    set({ status: "offline", sessionId: null });
  },

  sendPrompt: async (text) => {
    const { sessionId } = get();
    set((s) => ({ blocks: [...s.blocks, { kind: "user", text }] }));
    if (!client || !sessionId) {
      set({ error: "Not connected to an OpenCode server." });
      return;
    }
    try {
      await client.sendPrompt(sessionId, text);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
}));

export interface FoldState {
  blocks: ThreadBlock[];
  /** Maps an OpenCode part/call id to its block index (idempotent upserts). */
  index: Record<string, number>;
}

/** Pure reducer: fold one normalized OpenCode event into the live thread blocks. */
export function foldEvent(state: FoldState, event: OpenCodeEvent): FoldState {
  const blocks = [...state.blocks];
  const index = { ...state.index };
  switch (event.type) {
    case "text.updated": {
      const key = `text:${event.partId}`;
      if (key in index) {
        blocks[index[key]] = { kind: "agent", markdown: event.text };
      } else {
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
