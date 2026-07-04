import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowUp, Paperclip, Terminal, X } from "lucide-react";
import { addFilesToWorkspace, addTextToWorkspace, isTauri } from "@/lib/tauri";
import { useUiStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

/** A paste longer than this becomes a workspace file chip instead of raw text. */
const PASTE_AS_FILE_CHARS = 2000;
const PASTE_AS_FILE_LINES = 25;
/** Max composer height before it scrolls internally. */
const MAX_HEIGHT_PX = 160;

/** A "/" palette entry — the runtime's config commands, skills and MCP prompts. */
export interface ComposerCommand {
  name: string;
  description?: string;
  source?: string;
}

/**
 * The "Ask anything" composer. Static mock sessions pass no `onSend`; the live
 * OpenCode session passes one to submit prompts to the runtime. Attached
 * workspace files show as removable chips above the input, not as prompt text.
 *
 * Two prefix modes (only when their handler is provided):
 *   `!`  — shell mode: the rest of the line runs directly in the session's
 *          workspace folder (terminal styling, no model turn).
 *   `/`  — command palette: pick a slash command (config command / skill /
 *          MCP prompt) with ↑/↓ + Tab/Enter, then type arguments and send.
 *          A "/name" that matches no known command stays a plain prompt.
 */
export function Composer({
  onSend,
  onRunShell,
  onRunCommand,
  commands = [],
  disabled,
  placeholder = "Ask anything",
}: {
  onSend?: (text: string) => void;
  onRunShell?: (command: string) => void;
  onRunCommand?: (name: string, args: string) => void;
  commands?: ComposerCommand[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  /** Highlighted palette row; clamped to the current matches. */
  const [sel, setSel] = useState(0);
  /** Esc closed the palette for the current input; typing reopens it. */
  const [paletteClosed, setPaletteClosed] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composerDraft = useUiStore((s) => s.composerDraft);
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);

  const shellMode = !!onRunShell && value.startsWith("!");
  // The palette is open while the command NAME is being typed ("/na…"); the
  // first space ends name-typing (arguments follow) and closes it.
  const slashTyping = !!onRunCommand && /^\/\S*$/.test(value);
  const query = slashTyping ? value.slice(1).toLowerCase() : "";
  const matches = slashTyping
    ? commands
        .filter((c) => c.name.toLowerCase().includes(query))
        .sort(
          (a, b) =>
            Number(b.name.toLowerCase().startsWith(query)) -
            Number(a.name.toLowerCase().startsWith(query)),
        )
    : [];
  const paletteOpen = matches.length > 0 && !paletteClosed && !disabled;
  const selIndex = Math.min(sel, Math.max(matches.length - 1, 0));

  // Each edit resets the palette: selection back to the top, Esc-close undone.
  useEffect(() => {
    setSel(0);
    setPaletteClosed(false);
  }, [value]);

  const pick = (c: ComposerCommand) => {
    setValue(`/${c.name} `);
    taRef.current?.focus();
  };

  // Consume a draft another surface prepared (e.g. provenance "Reproduce") —
  // prefilled, never auto-sent: the user reviews and presses send. Text the
  // user was already typing is kept, with the draft appended below it.
  useEffect(() => {
    if (composerDraft === null) return;
    setValue((v) => (v.trim() ? `${v.trimEnd()}\n\n${composerDraft}` : composerDraft));
    setComposerDraft(null);
    taRef.current?.focus();
  }, [composerDraft, setComposerDraft]);

  // Auto-grow with the content, scroll internally beyond the cap.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    if (disabled) return;
    const text = value.trim();
    // "!" — run the rest of the line as a shell command (no model turn).
    if (shellMode) {
      const command = value.slice(1).trim();
      if (!command) return;
      onRunShell?.(command);
      setValue("");
      return;
    }
    // "/name args" — run a KNOWN slash command; unknown names stay a prompt
    // (a message can legitimately start with a path like "/etc/hosts …").
    if (onRunCommand && text.startsWith("/")) {
      const name = text.slice(1).split(/\s/, 1)[0];
      if (commands.some((c) => c.name === name)) {
        onRunCommand(name, text.slice(1 + name.length).trim());
        setValue("");
        return;
      }
    }
    if (!text && files.length === 0) return;
    const fileNote =
      files.length > 0 ? `Files added to the workspace: ${files.join(", ")}` : "";
    onSend?.(text && fileNote ? `${text}\n\n${fileNote}` : text || fileNote);
    setValue("");
    setFiles([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // During IME composition (e.g. pinyin), Enter picks a candidate — it must
    // not send. WebKit reports the committing keydown as legacy keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // While the palette is open, the keyboard drives it, not the send.
    if (paletteOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((i) => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPaletteClosed(true);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        pick(matches[selIndex]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Very long pastes become a workspace file chip instead of flooding the box.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!isTauri || !onSend) return;
    const text = e.clipboardData.getData("text/plain");
    if (text.length <= PASTE_AS_FILE_CHARS && text.split("\n").length <= PASTE_AS_FILE_LINES) {
      return; // normal paste
    }
    e.preventDefault();
    void (async () => {
      try {
        const name = await addTextToWorkspace("pasted.txt", text);
        setFiles((f) => [...f, name]);
      } catch (err) {
        toast.error(`Could not save paste: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  };

  // Copy local files into the agent workspace; they appear as chips.
  const addFiles = async () => {
    setAdding(true);
    try {
      const names = await addFilesToWorkspace();
      if (names.length > 0) setFiles((f) => [...f, ...names]);
    } catch (err) {
      toast.error(`Could not add files: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAdding(false);
    }
  };

  const canAttach = isTauri && !!onSend;
  const canSend =
    !disabled &&
    (shellMode ? value.slice(1).trim().length > 0 : !!value.trim() || files.length > 0);

  return (
    <div
      className={cn(
        "relative rounded-card border bg-surface px-2 py-2 shadow-card",
        shellMode ? "border-warn/60" : "border-border",
      )}
    >
      {paletteOpen && (
        <div
          role="listbox"
          aria-label="Commands"
          className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card"
        >
          {matches.map((c, i) => (
            <button
              key={c.name}
              role="option"
              aria-selected={i === selIndex}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-input px-2 py-1.5 text-left",
                i === selIndex ? "bg-surface-2" : "hover:bg-surface-2",
              )}
              // mousedown, not click — a click would blur the textarea first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span className="shrink-0 font-mono text-xs text-text">/{c.name}</span>
              {c.description && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{c.description}</span>
              )}
              {(c.source === "skill" || c.source === "mcp") && (
                <span className="shrink-0 rounded px-1 py-0.5 text-[10px] uppercase text-muted ring-1 ring-border">
                  {c.source}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {files.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1.5 rounded-input bg-surface-2 py-1 pl-2 pr-1 font-mono text-xs text-text ring-1 ring-border"
            >
              <Paperclip size={11} className="shrink-0 text-muted" />
              <span className="max-w-[220px] truncate">{name}</span>
              <button
                className="rounded p-0.5 text-muted hover:bg-border hover:text-text"
                aria-label={`Remove ${name}`}
                onClick={() => setFiles((f) => f.filter((n) => n !== name))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        {shellMode ? (
          <span
            className="flex h-7 shrink-0 items-center gap-1 rounded-input bg-warn/15 px-1.5 font-mono text-xs text-warn"
            title="Runs directly in the session's workspace folder"
          >
            <Terminal size={13} />
            shell
          </span>
        ) : (
          canAttach && (
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
              aria-label="Add files"
              title="Add local files to the workspace"
              onClick={() => void addFiles()}
              disabled={adding}
            >
              <Paperclip size={15} />
            </button>
          )
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={shellMode ? "Run a shell command in the workspace folder" : placeholder}
          className={cn(
            "max-h-[160px] w-full resize-none self-center bg-transparent px-1.5 py-0.5 text-sm leading-6 text-text outline-none placeholder:text-muted",
            shellMode && "font-mono",
          )}
          aria-label="Ask anything"
        />
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
          onClick={submit}
          disabled={!canSend}
        >
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}
