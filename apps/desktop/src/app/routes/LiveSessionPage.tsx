import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, Plug, PlugZap, Plus } from "lucide-react";
import { useRuntimeStore } from "@/lib/runtime";
import { BlockList } from "@/components/thread/BlockList";
import { Composer } from "@/components/thread/Composer";
import { cn } from "@/lib/cn";

/** Live agent session backed by the OpenCode runtime (real sessions + history). */
export function LiveSessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const {
    status,
    serverUrl,
    sessions,
    currentId,
    threads,
    error,
    connect,
    disconnect,
    openSession,
    newSession,
    sendPrompt,
  } = useRuntimeStore();

  const connected = status === "ready";
  const connecting = status === "connecting";

  // Open the routed session (loads its history); if none, jump to the newest.
  useEffect(() => {
    if (sessionId) {
      void openSession(sessionId);
    } else if (sessions.length > 0) {
      navigate(`/live/${sessions[0].id}`, { replace: true });
    }
  }, [sessionId, sessions, openSession, navigate]);

  const startNew = async () => {
    const id = await newSession();
    if (id) navigate(`/live/${id}`);
  };

  const thread = currentId ? threads[currentId] : undefined;
  const title = sessions.find((s) => s.id === currentId)?.title ?? "New session";
  const showEmpty = !currentId || (thread && thread.blocks.length === 0);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-8 py-4">
        <h1 className="truncate text-lg text-text">{currentId ? title : "Live session"}</h1>
        <div className="flex-1" />
        <ConnBadge status={status} />
        <button
          onClick={startNew}
          disabled={!connected}
          className="flex items-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2 disabled:opacity-40"
        >
          <Plus size={15} /> New
        </button>
        {connected ? (
          <button
            onClick={disconnect}
            className="flex items-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
          >
            <Plug size={15} /> Disconnect
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {connecting ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
            Connect
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-8 py-6">
          {!connected && (
            <div className="rounded-card border border-border bg-surface p-5 shadow-card">
              <div className="text-sm font-medium text-text">OpenCode runtime</div>
              <p className="mt-1 text-sm text-muted">
                The desktop app runs a bundled OpenCode automatically. In the browser, start one with{" "}
                <span className="font-mono">opencode serve</span> and connect.
              </p>
              <div className="mt-3 rounded-input bg-surface-2 px-3 py-2 font-mono text-xs text-text">
                {serverUrl}
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-input border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}
          {connected && showEmpty && (
            <div className="py-10 text-center text-sm text-muted">
              {currentId ? "Send a message to start this session." : "Start a new session to chat."}
            </div>
          )}
          {thread && <BlockList blocks={thread.blocks} />}
        </div>
      </div>

      <div className="border-t border-border px-8 py-4">
        <div className="mx-auto max-w-[760px]">
          <Composer
            onSend={sendPrompt}
            disabled={!connected || !currentId}
            placeholder={
              !connected
                ? "Connect to chat"
                : currentId
                  ? "Ask anything"
                  : "Start a new session first"
            }
          />
        </div>
      </div>
    </div>
  );
}

function ConnBadge({ status }: { status: string }) {
  const tone = status === "ready" ? "text-ok" : status === "error" ? "text-error" : "text-muted";
  return (
    <span className={cn("flex items-center gap-1.5 text-sm", tone)}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "ready" ? "bg-ok" : status === "error" ? "bg-error" : "bg-muted",
        )}
      />
      OpenCode · {status}
    </span>
  );
}
