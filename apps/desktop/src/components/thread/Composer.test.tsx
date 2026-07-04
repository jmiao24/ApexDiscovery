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
