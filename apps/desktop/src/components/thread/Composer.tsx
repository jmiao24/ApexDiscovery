import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { addFilesToWorkspace, addTextToWorkspace, isTauri } from "@/lib/tauri";
import { toast } from "@/lib/toast";

/** A paste longer than this becomes a workspace file chip instead of raw text. */
const PASTE_AS_FILE_CHARS = 2000;
const PASTE_AS_FILE_LINES = 25;
/** Max composer height before it scrolls internally. */
const MAX_HEIGHT_PX = 160;

/**
 * The "Ask anything" composer. Static mock sessions pass no `onSend`; the live
 * OpenCode session passes one to submit prompts to the runtime. Attached
 * workspace files show as removable chips above the input, not as prompt text.
 */
export function Composer({
  onSend,
  disabled,
  placeholder = "Ask anything",
}: {
  onSend?: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow with the content, scroll internally beyond the cap.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if ((!text && files.length === 0) || disabled) return;
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
  const canSend = !disabled && (!!value.trim() || files.length > 0);

  return (
    <div className="rounded-card border border-border bg-surface px-2 py-2 shadow-card">
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
        {canAttach && (
          <button
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
            aria-label="Add files"
            title="Add local files to the workspace"
            onClick={() => void addFiles()}
            disabled={adding}
          >
            <Paperclip size={15} />
          </button>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          className="max-h-[160px] w-full resize-none self-center bg-transparent px-1.5 py-0.5 text-sm leading-6 text-text outline-none placeholder:text-muted"
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
