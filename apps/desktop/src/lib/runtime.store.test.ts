// Workspace-per-session behavior: a fresh draft's first message creates a new
// dated folder by default; an explicit switcher choice pins the destination.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  newDatedWorkspace: vi.fn(async (name: string) => `/ws/${name}`),
  setWorkspace: vi.fn(async (path: string) => path),
  kernelReset: vi.fn(async () => {}),
  /** Number of connect() attempts that fail before one succeeds. */
  failConnects: 0,
  /** Number of createSession() attempts that fail before one succeeds. */
  failCreates: 0,
  /** Fire a normalized event into the store, as the SSE stream would. */
  fireEvent: (_e: unknown) => {},
}));

vi.mock("./tauri", () => ({
  isTauri: true,
  logDebug: async () => {},
  detectTools: async () => [],
  startRuntime: async () => "http://127.0.0.1:1",
  workspacePath: async () => "/ws/base",
  setWorkspace: mocks.setWorkspace,
  newDatedWorkspace: mocks.newDatedWorkspace,
}));
vi.mock("./kernel", () => ({ kernelReset: mocks.kernelReset }));
vi.mock("@ai4s/sdk", () => {
  class OpenCodeClient {
    private statusCb: (s: string) => void = () => {};
    onStatus(cb: (s: string) => void) {
      this.statusCb = cb;
    }
    onEvent(cb: (e: unknown) => void) {
      mocks.fireEvent = cb;
    }
    async connect() {
      if (mocks.failConnects > 0) {
        mocks.failConnects--;
        throw new Error("Could not open OpenCode event stream");
      }
      this.statusCb("ready");
    }
    async listSessions() {
      return [];
    }
    async listSkills() {
      return [{ name: "stub" }];
    }
    async listAgents() {
      return [];
    }
    async getDefaultModel() {
      return null;
    }
    async createSession() {
      if (mocks.failCreates > 0) {
        mocks.failCreates--;
        throw new Error("Load failed");
      }
      return "ses_new";
    }
    async sendPrompt() {}
    close() {}
  }
  return { OpenCodeClient, DEFAULT_OPENCODE_URL: "http://127.0.0.1:4096" };
});

import { DRAFT_KEY, useRuntimeStore } from "./runtime";

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.failConnects = 0;
  mocks.failCreates = 0;
  useRuntimeStore.setState({
    currentId: null,
    workspacePinned: false,
    threads: {},
    error: null,
    sending: false,
    runningSessions: {},
  });
  await useRuntimeStore.getState().connect();
  expect(useRuntimeStore.getState().status).toBe("ready");
});

describe("per-session workspace folders", () => {
  it("creates a fresh dated folder before the first message of an unpinned draft", async () => {
    const id = await useRuntimeStore.getState().sendPrompt("hello");
    expect(id).toBe("ses_new");
    expect(mocks.newDatedWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.newDatedWorkspace.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
    // The kernel is reset so it respawns inside the new folder.
    expect(mocks.kernelReset).toHaveBeenCalled();
  });

  it("keeps a pinned folder: no dated folder is created", async () => {
    useRuntimeStore.setState({ workspacePinned: true });
    const id = await useRuntimeStore.getState().sendPrompt("hello");
    expect(id).toBe("ses_new");
    expect(mocks.newDatedWorkspace).not.toHaveBeenCalled();
  });

  it("does not create another folder for later messages in the same session", async () => {
    await useRuntimeStore.getState().sendPrompt("first");
    await useRuntimeStore.getState().sendPrompt("second");
    expect(mocks.newDatedWorkspace).toHaveBeenCalledTimes(1);
  });

  it("masks transient connect errors while deliberately reconnecting", async () => {
    mocks.failConnects = 1;
    const done = useRuntimeStore.getState().connectRetry(3);
    await new Promise((r) => setTimeout(r, 50)); // after the first failed attempt
    expect(useRuntimeStore.getState().status).toBe("connecting");
    expect(useRuntimeStore.getState().error).toBe(null);
    await done;
    expect(useRuntimeStore.getState().status).toBe("ready");
    expect(useRuntimeStore.getState().error).toBe(null);
  });

  it("surfaces the last error only when the retry window is exhausted", async () => {
    mocks.failConnects = 99;
    await useRuntimeStore.getState().connectRetry(1);
    expect(useRuntimeStore.getState().status).toBe("error");
    expect(useRuntimeStore.getState().error).toContain("event stream");
  });

  it("echoes the first message instantly into the draft, then grafts it onto the session", async () => {
    const p = useRuntimeStore.getState().sendPrompt("hi");
    // Synchronously (before any await resolves): the message is visible and
    // the composer is locked — the user is never staring at an unchanged page.
    expect(useRuntimeStore.getState().sending).toBe(true);
    expect(useRuntimeStore.getState().threads[DRAFT_KEY]?.blocks).toEqual([
      { kind: "user", text: "hi" },
    ]);
    await p;
    const s = useRuntimeStore.getState();
    expect(s.currentId).toBe("ses_new");
    expect(s.threads[DRAFT_KEY]).toBeUndefined();
    expect(s.threads["ses_new"].blocks).toEqual([{ kind: "user", text: "hi" }]);
    expect(s.sending).toBe(false);
    expect(s.runningSessions["ses_new"]).toBe(true); // turn active until idle
  });

  it("ignores a second send while one is in flight", async () => {
    const p = useRuntimeStore.getState().sendPrompt("hi");
    const second = await useRuntimeStore.getState().sendPrompt("hi again");
    expect(second).toBe(null);
    await p;
    expect(useRuntimeStore.getState().threads[DRAFT_KEY] ?? undefined).toBeUndefined();
    expect(useRuntimeStore.getState().threads["ses_new"].blocks).toHaveLength(1);
  });

  it("session.idle ends the turn: running cleared, done line folded in", async () => {
    await useRuntimeStore.getState().sendPrompt("hi");
    expect(useRuntimeStore.getState().runningSessions["ses_new"]).toBe(true);
    mocks.fireEvent({ type: "session.idle", sessionId: "ses_new" });
    const s = useRuntimeStore.getState();
    expect(s.runningSessions["ses_new"]).toBeUndefined();
    expect(s.threads["ses_new"].blocks.slice(-1)[0]).toMatchObject({ kind: "status-line", tone: "done" });
  });

  it("a session error lands as a red line in the thread and unlocks the turn", async () => {
    await useRuntimeStore.getState().sendPrompt("hi");
    mocks.fireEvent({ type: "error", sessionId: "ses_new", message: "model unavailable" });
    const s = useRuntimeStore.getState();
    expect(s.runningSessions["ses_new"]).toBeUndefined();
    expect(s.threads["ses_new"].blocks.slice(-1)[0]).toEqual({
      kind: "status-line",
      text: "model unavailable",
      tone: "error",
    });
  });

  it("retries a failed createSession once (transient 'Load failed')", async () => {
    mocks.failCreates = 1;
    const id = await useRuntimeStore.getState().sendPrompt("hi");
    expect(id).toBe("ses_new");
    expect(useRuntimeStore.getState().error).toBe(null);
  });

  it("a hard create failure shows a red line in the draft and unlocks the composer", async () => {
    mocks.failCreates = 99;
    const id = await useRuntimeStore.getState().sendPrompt("hi");
    expect(id).toBe(null);
    const s = useRuntimeStore.getState();
    expect(s.sending).toBe(false);
    expect(s.threads[DRAFT_KEY].blocks.slice(-1)[0]).toMatchObject({
      kind: "status-line",
      tone: "error",
    });
  });

  it("marks a deliberate switch as `switching` for its whole duration", async () => {
    mocks.failConnects = 1; // keep the reconnect in flight for one retry beat
    const done = useRuntimeStore.getState().switchWorkspace({ path: "/ws/mine" });
    await new Promise((r) => setTimeout(r, 50));
    expect(useRuntimeStore.getState().switching).toBe(true);
    await done;
    expect(useRuntimeStore.getState().switching).toBe(false);
    expect(useRuntimeStore.getState().status).toBe("ready");
  });

  it("switchWorkspace pins the chosen folder; startDraft un-pins it", async () => {
    await useRuntimeStore.getState().switchWorkspace({ path: "/ws/mine" });
    expect(mocks.setWorkspace).toHaveBeenCalledWith("/ws/mine");
    expect(useRuntimeStore.getState().workspacePinned).toBe(true);
    useRuntimeStore.getState().startDraft();
    expect(useRuntimeStore.getState().workspacePinned).toBe(false);
  });
});
