import type { ModelStatus, RuntimeStatus } from "@ai4s/shared";
import { cn } from "@/lib/cn";

// Mock statuses this slice; wired to the runtime in slice #2/#3.
const runtime: RuntimeStatus = "ready";
const model: ModelStatus = "connected";

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
