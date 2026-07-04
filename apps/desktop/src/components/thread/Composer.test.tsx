import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useUiStore } from "@/lib/store";
import { Composer } from "./Composer";

describe("Composer", () => {
  it("appends a prepared draft below text the user was already typing", () => {
    useUiStore.setState({ composerDraft: null });
    render(<Composer onSend={vi.fn()} />);
    const input = screen.getByLabelText<HTMLTextAreaElement>("Ask anything");
    fireEvent.change(input, { target: { value: "half-written thought" } });

    act(() => useUiStore.getState().setComposerDraft("Reproduce `fig/plot.py`…"));
    expect(input.value).toBe("half-written thought\n\nReproduce `fig/plot.py`…");
    expect(useUiStore.getState().composerDraft).toBeNull(); // consumed once

    // An empty composer takes the draft as-is.
    fireEvent.change(input, { target: { value: "" } });
    act(() => useUiStore.getState().setComposerDraft("just the draft"));
    expect(input.value).toBe("just the draft");
  });

  it("sends on Enter but never during IME composition", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByLabelText("Ask anything");
    fireEvent.change(input, { target: { value: "ni hao" } });

    // Enter while composing (picking a pinyin candidate) must not send.
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    // WebKit reports the committing keydown as legacy keyCode 229.
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    // Shift+Enter inserts a newline, never sends.
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("ni hao");
  });

  it("does not send when empty or disabled", () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer onSend={onSend} />);
    const input = screen.getByLabelText("Ask anything");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    rerender(<Composer onSend={onSend} disabled />);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});

const COMMANDS = [
  { name: "init", description: "guided AGENTS.md setup", source: "command" },
  { name: "analyze-data", description: "Analyze a dataset end to end.", source: "skill" },
];

describe("Composer '!' shell mode", () => {
  it("switches on the leading '!' and Enter runs the command, not a prompt", () => {
    const onSend = vi.fn();
    const onRunShell = vi.fn();
    render(<Composer onSend={onSend} onRunShell={onRunShell} />);
    const input = screen.getByLabelText<HTMLTextAreaElement>("Ask anything");
    fireEvent.change(input, { target: { value: "!pwd && ls" } });
    expect(screen.getByText("shell")).toBeInTheDocument(); // mode is visible
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRunShell).toHaveBeenCalledWith("pwd && ls");
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe(""); // cleared for the next command
  });

  it("a bare '!' runs nothing", () => {
    const onRunShell = vi.fn();
    render(<Composer onSend={vi.fn()} onRunShell={onRunShell} />);
    const input = screen.getByLabelText("Ask anything");
    fireEvent.change(input, { target: { value: "!  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRunShell).not.toHaveBeenCalled();
  });

  it("stays a plain prompt when no shell handler is provided (mock sessions)", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const input = screen.getByLabelText("Ask anything");
    fireEvent.change(input, { target: { value: "!pwd" } });
    expect(screen.queryByText("shell")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("!pwd");
  });
});

describe("Composer '/' command palette", () => {
  it("opens on '/', filters while typing, and Enter autocompletes the selection", () => {
    render(<Composer onSend={vi.fn()} onRunCommand={vi.fn()} commands={COMMANDS} />);
    const input = screen.getByLabelText<HTMLTextAreaElement>("Ask anything");
    fireEvent.change(input, { target: { value: "/ana" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" }); // autocomplete, not send
    expect(input.value).toBe("/analyze-data ");
    expect(screen.queryByRole("listbox")).toBeNull(); // arguments next
  });

  it("Enter sends a completed command with its arguments", () => {
    const onSend = vi.fn();
    const onRunCommand = vi.fn();
    render(<Composer onSend={onSend} onRunCommand={onRunCommand} commands={COMMANDS} />);
    const input = screen.getByLabelText("Ask anything");
    fireEvent.change(input, { target: { value: "/init focus on tests" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRunCommand).toHaveBeenCalledWith("init", "focus on tests");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("arrow keys move the selection; Escape closes the palette", () => {
    render(<Composer onSend={vi.fn()} onRunCommand={vi.fn()} commands={COMMANDS} />);
    const input = screen.getByLabelText("Ask anything");
    fireEvent.change(input, { target: { value: "/" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("an unknown '/name' falls back to a plain prompt", () => {
    const onSend = vi.fn();
    const onRunCommand = vi.fn();
    render(<Composer onSend={onSend} onRunCommand={onRunCommand} commands={COMMANDS} />);
    const input = screen.getByLabelText("Ask anything");
    fireEvent.change(input, { target: { value: "/etc/hosts looks wrong" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/etc/hosts looks wrong");
    expect(onRunCommand).not.toHaveBeenCalled();
  });
});
