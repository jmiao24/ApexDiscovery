import type { ModelStatus, RuntimeStatus } from "@ai4s/shared";
import { useRuntimeStore } from "@/lib/runtime";
import { cn } from "@/lib/cn";

const RUNTIME_TONE: Record<RuntimeStatus, string> = {
  ready: "bg-ok",
  connecting: "bg-warn",
  error: "bg-error",
  offline: "bg-muted",
};

const MODEL_TONE: Record<ModelStatus, string> = {
  connected: "bg-ok",
  disconnected: "bg-muted",
  error: "bg-error",
};

export function StatusPills() {
  // Runtime status is live from the OpenCode client. Model is disconnected until a key is set.
  const runtime = useRuntimeStore((s) => s.status);
  const model: ModelStatus = "disconnected";

  return (
    <div className="flex flex-col gap-1 text-xs text-muted">
      <Pill dot={RUNTIME_TONE[runtime]} label="Runtime" value={runtime} />
      <Pill dot={MODEL_TONE[model]} label="Model" value={model} />
    </div>
  );
}

function Pill({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-2">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      <span>{label}</span>
      <span className="ml-auto capitalize text-text/70">{value}</span>
    </div>
  );
}
