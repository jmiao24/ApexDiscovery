// Workspace-per-session behavior: a fresh draft's first message creates a new
// dated folder by default; an explicit switcher choice pins the destination.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  newDatedWorkspace: vi.fn(async (name: string) => `/ws/${name}`),
  setWorkspace: vi.fn(async (path: string) => path),
  kernelReset: vi.fn(async () => {}),
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
    onEvent() {}
    async connect() {
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
      return "ses_new";
    }
    async sendPrompt() {}
    close() {}
  }
  return { OpenCodeClient, DEFAULT_OPENCODE_URL: "http://127.0.0.1:4096" };
});

import { useRuntimeStore } from "./runtime";

beforeEach(async () => {
  vi.clearAllMocks();
  useRuntimeStore.setState({ currentId: null, workspacePinned: false, threads: {}, error: null });
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

  it("switchWorkspace pins the chosen folder; startDraft un-pins it", async () => {
    await useRuntimeStore.getState().switchWorkspace({ path: "/ws/mine" });
    expect(mocks.setWorkspace).toHaveBeenCalledWith("/ws/mine");
    expect(useRuntimeStore.getState().workspacePinned).toBe(true);
    useRuntimeStore.getState().startDraft();
    expect(useRuntimeStore.getState().workspacePinned).toBe(false);
  });
});
