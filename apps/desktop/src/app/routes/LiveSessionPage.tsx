import { Loader2, Plug, PlugZap } from "lucide-react";
import { useRuntimeStore } from "@/lib/runtime";
import { BlockList } from "@/components/thread/BlockList";
import { Composer } from "@/components/thread/Composer";
import { cn } from "@/lib/cn";

/** Live agent session backed by the OpenCode runtime (packages/sdk). */
export function LiveSessionPage() {
  const { status, serverUrl, blocks, error, connect, disconnect, sendPrompt } = useRuntimeStore();
  const connected = status === "ready";
  const connecting = status === "connecting";

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-8 py-4">
        <h1 className="text-lg text-text">New session</h1>
        <div className="flex-1" />
        <ConnBadge status={status} />
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
          {!connected && blocks.length === 0 && (
            <div className="rounded-card border border-border bg-surface p-5 shadow-card">
              <div className="text-sm font-medium text-text">Connect to the OpenCode runtime</div>
              <p className="mt-1 text-sm text-muted">
                AI4S Workbench drives the agent through OpenCode (`opencode serve`) over its
                HTTP + SSE API. Point it at a running server, then send a prompt to start a live session.
              </p>
              <div className="mt-3 rounded-input bg-surface-2 px-3 py-2 font-mono text-xs text-text">
                {serverUrl}
              </div>
              <p className="mt-2 text-xs text-muted">
                Not running yet? Start it with <span className="font-mono">opencode serve</span>, or
                set the URL in Settings. Example sessions in the sidebar are read-only.
              </p>
            </div>
          )}
          {error && (
            <div className="rounded-input border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}
          <BlockList blocks={blocks} />
        </div>
      </div>

      <div className="border-t border-border px-8 py-4">
        <div className="mx-auto max-w-[760px]">
          <Composer
            onSend={sendPrompt}
            placeholder={connected ? "Ask anything" : "Connect to send — or browse the samples"}
          />
        </div>
      </div>
    </div>
  );
}

function ConnBadge({ status }: { status: string }) {
  const tone =
    status === "ready" ? "text-ok" : status === "error" ? "text-error" : "text-muted";
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
