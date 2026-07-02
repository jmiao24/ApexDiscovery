import { create } from "zustand";
import { HermesClient, type GatewayEvent } from "@ai4s/sdk";
import type { RuntimeStatus, ThreadBlock } from "@ai4s/shared";

const URL_KEY = "ai4s.gatewayUrl";
const DEFAULT_URL = "ws://127.0.0.1:8765";

function initialUrl(): string {
  if (typeof window === "undefined") return DEFAULT_URL;
  return window.localStorage.getItem(URL_KEY) ?? DEFAULT_URL;
}

interface RuntimeState {
  status: RuntimeStatus;
  gatewayUrl: string;
  sessionId: string | null;
  blocks: ThreadBlock[];
  error: string | null;
  activeAgentIndex: number | null;
  setGatewayUrl: (url: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendPrompt: (text: string) => Promise<void>;
}

// The client lives outside the store (it is not serializable state).
let client: HermesClient | null = null;

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  status: "offline",
  gatewayUrl: initialUrl(),
  sessionId: null,
  blocks: [],
  error: null,
  activeAgentIndex: null,

  setGatewayUrl: (gatewayUrl) => {
    if (typeof window !== "undefined") window.localStorage.setItem(URL_KEY, gatewayUrl);
    set({ gatewayUrl });
  },

  connect: async () => {
    get().disconnect();
    const c = new HermesClient({ url: get().gatewayUrl });
    client = c;
    c.onStatus((status) => set({ status }));
    c.onEvent((event) =>
      set((s) => {
        const folded = foldGatewayEvent(
          { blocks: s.blocks, activeAgentIndex: s.activeAgentIndex },
          event,
        );
        return {
          blocks: folded.blocks,
          activeAgentIndex: folded.activeAgentIndex,
          error: event.type === "error" ? event.message : s.error,
        };
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
    set((s) => ({
      blocks: [...s.blocks, { kind: "user", text }],
      activeAgentIndex: null,
    }));
    if (!client || !sessionId) {
      set({ error: "Not connected to a Hermes Gateway." });
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
  activeAgentIndex: number | null;
}

/** Pure reducer: fold one streamed Gateway event into the live thread blocks. */
export function foldGatewayEvent(state: FoldState, event: GatewayEvent): FoldState {
  const blocks = [...state.blocks];
  switch (event.type) {
    case "message.delta": {
      if (state.activeAgentIndex != null && blocks[state.activeAgentIndex]?.kind === "agent") {
        const cur = blocks[state.activeAgentIndex] as { kind: "agent"; markdown: string };
        blocks[state.activeAgentIndex] = { kind: "agent", markdown: cur.markdown + event.text };
        return { blocks, activeAgentIndex: state.activeAgentIndex };
      }
      blocks.push({ kind: "agent", markdown: event.text });
      return { blocks, activeAgentIndex: blocks.length - 1 };
    }
    case "tool.start":
      blocks.push({ kind: "tool-call", title: event.title, status: "running" });
      return { blocks, activeAgentIndex: null };
    case "tool.complete": {
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b.kind === "tool-call" && b.status === "running") {
          blocks[i] = { ...b, status: event.status, meta: event.meta };
          break;
        }
      }
      return { blocks, activeAgentIndex: state.activeAgentIndex };
    }
    case "session.done":
      blocks.push({ kind: "status-line", text: "done", tone: "done" });
      return { blocks, activeAgentIndex: null };
    default:
      return state;
  }
}
