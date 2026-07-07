import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@ai4s/shared";
import { useUiStore } from "@/lib/store";
import { RunsPage } from "./RunsPage";

const listRuns = vi.fn();
const readRunLog = vi.fn();
vi.mock("@/lib/runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runs")>()),
  listRuns: () => listRuns(),
  readRunLog: (hash: string) => readRunLog(hash),
}));

const run: RunRecord = {
  runId: "run_ab12cd34",
  ts: 1751500000,
  sessionId: "ses_1",
  command: "python train.py --lr 3e-4",
  status: "ok",
  wallMs: 8000,
  logHash: "cafe1234",
  code: [{ path: "train.py", hash: "aaaa", size: 512 }],
  outputs: [{ path: "output/metrics.json", hash: "bbbb", size: 64 }],
  env: {
    python: "3.11.4",
    platform: "linux-x86_64",
    app: "0.1.3",
    packages: { count: 51, hash: "deadbeef" },
    hardware: { cpu: "AMD EPYC 7742", cores: 64, memGb: 512, gpu: ["NVIDIA A100-SXM4-40GB"], accelerator: "cuda" },
  },
};

const renderPage = (entry = "/runs") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <RunsPage />
    </MemoryRouter>,
  );

describe("RunsPage", () => {
  beforeEach(() => {
    listRuns.mockReset();
    readRunLog.mockReset();
  });

  it("lists runs with their command, and expands to show the recipe", async () => {
    listRuns.mockResolvedValue([run]);
    renderPage();

    expect(await screen.findByText("python train.py --lr 3e-4")).toBeInTheDocument();
    // Expanded (first run open): hardware, outputs, and env show.
    expect(screen.getByText(/NVIDIA A100-SXM4-40GB/)).toBeInTheDocument();
    expect(screen.getByText("output/metrics.json")).toBeInTheDocument();
    expect(screen.getByText(/3.11.4/)).toBeInTheDocument();
  });

  it("drafts the run recipe when Reproduce is clicked", async () => {
    listRuns.mockResolvedValue([run]);
    useUiStore.setState({ composerDraft: null });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Reproduce/ }));
    const draft = useUiStore.getState().composerDraft;
    expect(draft).toContain("Reproduce run `run_ab12cd34`");
    expect(draft).toContain("python train.py --lr 3e-4");
    expect(draft).toContain("output/metrics.json");
  });

  it("loads the captured log on demand", async () => {
    listRuns.mockResolvedValue([run]);
    readRunLog.mockResolvedValue("epoch 1\naccuracy 0.93\n");
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Log/ }));
    expect(readRunLog).toHaveBeenCalledWith("cafe1234");
    expect(await screen.findByText(/accuracy 0.93/)).toBeInTheDocument();
  });

  it("expands the run named in the ?run= query param (deep link from an artifact)", async () => {
    const older: RunRecord = {
      ...run,
      runId: "run_older",
      command: "python prep.py",
      code: [{ path: "prep.py", hash: "eeee", size: 30 }],
      outputs: [],
      logHash: undefined,
    };
    // `run` (newest) first, then the older one; deep-link targets the older.
    listRuns.mockResolvedValue([run, older]);
    renderPage("/runs?run=run_older");

    // The TARGET is expanded — its code file shows…
    expect(await screen.findByText("prep.py")).toBeInTheDocument();
    // …while the newest run is collapsed, so its output isn't shown.
    expect(screen.queryByText("output/metrics.json")).not.toBeInTheDocument();
  });

  it("renders a run whose code/outputs arrays were omitted by the store", async () => {
    // The Rust store omits empty arrays, so code/outputs can arrive undefined —
    // the card must render, not crash on `.length`.
    const bare = { ...run, code: undefined, outputs: undefined, logHash: undefined } as unknown as RunRecord;
    listRuns.mockResolvedValue([bare]);
    renderPage();
    expect(await screen.findByText("python train.py --lr 3e-4")).toBeInTheDocument();
  });

  it("explains the empty state", async () => {
    listRuns.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No runs recorded yet/)).toBeInTheDocument();
  });
});
