import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2, RefreshCw, X } from "lucide-react";
import {
  addComputeMachine,
  computeCancel,
  computeJobs,
  computeMachines,
  computeProbe,
  isTauri,
  listSshHosts,
  removeComputeMachine,
  type ComputeJob,
  type ComputeProbe,
  type GpuInfo,
  type Machine,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

/**
 * Remote compute over SSH. Connect any machine you can SSH to (CPU or GPU;
 * Slurm optional). Each machine shows capability chips and an expandable
 * detail: a usage snapshot (non-Slurm) or the Slurm queue (Slurm). The chosen
 * host is recorded in .openscience/compute.json for the remote-compute skill.
 */
export function RemoteComputeCard() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Per-host live probe + expand/queue state, keyed by host.
  const [probes, setProbes] = useState<Record<string, ComputeProbe | "loading">>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<Record<string, ComputeJob[] | null>>({});

  const probe = useCallback(async (host: string) => {
    setProbes((p) => ({ ...p, [host]: "loading" }));
    try {
      const result = await computeProbe(host);
      setProbes((p) => ({ ...p, [host]: result }));
      // Read the queue only for Slurm hosts — no queue exists otherwise.
      if (result.slurm) {
        // A Slurm host's detail *is* the queue — open it by default.
        setExpanded((e) => ({ ...e, [host]: true }));
        try {
          const list = await computeJobs(host);
          setJobs((j) => ({ ...j, [host]: list }));
        } catch {
          setJobs((j) => ({ ...j, [host]: null }));
        }
      }
    } catch (e) {
      setProbes((p) => ({
        ...p,
        [host]: { reachable: false, message: e instanceof Error ? e.message : String(e) } as ComputeProbe,
      }));
    }
  }, []);

  const loadMachines = useCallback(async () => {
    const list = await computeMachines().catch(() => []);
    setMachines(list);
    list.forEach((m) => void probe(m.host));
  }, [probe]);

  useEffect(() => {
    if (!isTauri) return;
    void listSshHosts().then(setHosts).catch(() => undefined);
    void loadMachines();
  }, [loadMachines]);

  const add = async () => {
    const host = draft.trim();
    if (!host) return;
    setAdding(true);
    setAddError(null);
    try {
      await addComputeMachine(host, undefined);
      setDraft("");
      await loadMachines();
      void probe(host);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (host: string) => {
    try {
      await removeComputeMachine(host);
      setMachines((m) => m.filter((x) => x.host !== host));
    } catch (e) {
      toast.error(`Could not remove: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const cancel = async (host: string, id: string) => {
    try {
      await computeCancel(host, id);
      toast.success(`Job ${id} canceled`);
      const list = await computeJobs(host);
      setJobs((j) => ({ ...j, [host]: list }));
    } catch (e) {
      toast.error(`Could not cancel ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section className="mt-5 rounded-card border border-border bg-surface shadow-card">
      <header className="border-b border-border px-5 py-3">
        <h2 className="font-serif text-[15px] text-text">Remote compute</h2>
        <p className="mt-0.5 text-xs text-muted">
          Run jobs on your own servers over SSH — CPU or GPU; Slurm optional. Uses your own SSH
          keys; nothing is installed on the machine.
        </p>
      </header>
      <div className="px-5 py-4">
        {!isTauri ? (
          <p className="text-[13px] text-muted">Available in the desktop app.</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-input border border-border">
              {machines.length === 0 && (
                <p className="bg-surface px-3 py-2.5 text-[13px] text-muted">
                  No machines yet — add one below.
                </p>
              )}
              {machines.map((m, i) => (
                <MachineRow
                  key={m.host}
                  machine={m}
                  probe={probes[m.host]}
                  expanded={!!expanded[m.host]}
                  jobs={jobs[m.host]}
                  first={i === 0}
                  onToggle={() => setExpanded((e) => ({ ...e, [m.host]: !e[m.host] }))}
                  onRefresh={() => void probe(m.host)}
                  onRemove={() => void remove(m.host)}
                  onCancel={(id) => void cancel(m.host, id)}
                />
              ))}
              <div className={cn("bg-surface-2/50 p-3", machines.length > 0 && "border-t border-border")}>
                <div className="flex items-center gap-2">
                  <input
                    list="ssh-hosts"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void add()}
                    placeholder={
                      hosts.length > 0
                        ? `user@host — or pick from your ~/.ssh/config (${hosts.length})`
                        : "user@host.example.edu"
                    }
                    className={inputCls("flex-1 font-mono")}
                  />
                  <datalist id="ssh-hosts">
                    {hosts.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                  <button className={btnAccent()} onClick={() => void add()} disabled={adding || !draft.trim()}>
                    {adding ? <Loader2 size={12} className="animate-spin" /> : null}
                    {adding ? "Adding…" : "Add"}
                  </button>
                </div>
                {addError && <p className="mt-2 text-xs text-error">{addError}</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function MachineRow({
  machine,
  probe,
  expanded,
  jobs,
  first,
  onToggle,
  onRefresh,
  onRemove,
  onCancel,
}: {
  machine: Machine;
  probe: ComputeProbe | "loading" | undefined;
  expanded: boolean;
  jobs: ComputeJob[] | null | undefined;
  first: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onCancel: (id: string) => void;
}) {
  const loading = probe === "loading" || probe === undefined;
  const p = typeof probe === "object" ? probe : null;
  const reachable = !!p?.reachable;
  const chips = p && reachable ? capabilityChips(p) : [];
  return (
    <div className={cn("bg-surface", !first && "border-t border-border")}>
      <div className="flex items-center gap-2.5 px-3 py-2.5 text-[13px]">
        <button
          className="shrink-0 text-muted transition-colors hover:text-text"
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight size={13} className={cn("transition-transform", expanded && "rotate-90")} />
        </button>
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            loading ? "bg-muted" : reachable ? "bg-ok" : "bg-error",
          )}
        />
        <span className="font-mono font-medium text-text">{machine.label || machine.host}</span>
        {machine.label && <span className="text-xs text-muted">{machine.host}</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {loading ? "checking…" : reachable ? chips.join(" · ") : p?.message ?? "unreachable"}
        </span>
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input text-muted transition-colors hover:bg-surface-2 hover:text-text"
          onClick={onRefresh}
          title="Re-probe this machine"
          aria-label="Re-probe this machine"
        >
          <RefreshCw size={13} className={cn(loading && "animate-spin")} />
        </button>
        <button
          className="shrink-0 text-xs text-muted transition-colors hover:text-error"
          onClick={onRemove}
          title="Remove this machine"
        >
          Remove
        </button>
      </div>
      {expanded && reachable && p && (
        <div className="border-t border-border bg-surface-2/40 px-3 py-2.5">
          {p.slurm ? (
            <SlurmQueue jobs={jobs} onCancel={onCancel} />
          ) : (
            <UsageSnapshot p={p} />
          )}
        </div>
      )}
    </div>
  );
}

function UsageSnapshot({ p }: { p: ComputeProbe }) {
  return (
    <div className="space-y-1.5 text-xs text-muted">
      {p.cores != null && p.load1 != null && (
        <div>
          <span className="text-text">CPU load</span> {p.load1.toFixed(2)} / {p.cores} cores
        </div>
      )}
      {p.mem_total_bytes != null && (
        <div>
          <span className="text-text">Memory</span>{" "}
          {fmtBytes((p.mem_total_bytes ?? 0) - (p.mem_avail_bytes ?? 0))} / {fmtBytes(p.mem_total_bytes)}
        </div>
      )}
      {p.gpus.map((g, i) => (
        <div key={i}>
          <span className="text-text">{g.name}</span> {g.util_pct}% ·{" "}
          {Math.round(g.mem_used_mib / 1024)} / {Math.round(g.mem_total_mib / 1024)} GB
        </div>
      ))}
      {p.disk_free_bytes != null && p.disk_total_bytes != null && (
        <div>
          <span className="text-text">Disk</span> {fmtBytes(p.disk_free_bytes)} free /{" "}
          {fmtBytes(p.disk_total_bytes)}
        </div>
      )}
    </div>
  );
}

function SlurmQueue({
  jobs,
  onCancel,
}: {
  jobs: ComputeJob[] | null | undefined;
  onCancel: (id: string) => void;
}) {
  if (jobs === undefined) return <p className="text-xs text-muted">Reading the queue…</p>;
  if (jobs === null) return <p className="text-xs text-muted">Queue unavailable.</p>;
  if (jobs.length === 0) return <p className="text-xs text-muted">No jobs in the queue.</p>;
  return (
    <div className="space-y-1">
      {jobs.map((j) => (
        <div key={j.id} className="flex items-center gap-2.5 text-[13px]">
          <span className="font-mono text-xs text-muted">{j.id}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-border",
              j.state === "RUNNING" ? "text-ok" : j.state === "PENDING" ? "text-warn" : "text-muted",
            )}
          >
            {j.state}
          </span>
          <span className="min-w-0 flex-1 truncate text-text">{j.name}</span>
          <span className="font-mono text-xs text-muted">{j.time}</span>
          <span className="text-xs text-muted">{j.partition}</span>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-input text-muted transition-colors hover:bg-surface-2 hover:text-error"
            onClick={() => onCancel(j.id)}
            title={`Cancel job ${j.id}`}
            aria-label={`Cancel job ${j.id}`}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Collapsed identity chips, e.g. ["16 cores", "64 GB", "2× RTX 3090", "1.2 TB free"]. */
function capabilityChips(p: ComputeProbe): string[] {
  const chips: string[] = [];
  if (p.cores != null) chips.push(`${p.cores} cores`);
  if (p.mem_total_bytes != null) chips.push(fmtBytes(p.mem_total_bytes));
  const gpu = gpuSummary(p.gpus);
  if (gpu) chips.push(gpu);
  if (p.disk_free_bytes != null) chips.push(`${fmtBytes(p.disk_free_bytes)} free`);
  if (p.slurm) chips.push(p.slurm.replace(/^slurm\s*/i, "Slurm "));
  return chips;
}

function gpuSummary(gpus: GpuInfo[]): string | null {
  if (gpus.length === 0) return null;
  const name = gpus[0].name;
  return gpus.every((g) => g.name === name) ? `${gpus.length}× ${name}` : `${gpus.length} GPUs`;
}

/** Bytes → short human string: 64 GB, 1.2 TB, 400 GB. */
function fmtBytes(n: number | null): string {
  if (n == null) return "?";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

const inputCls = (extra = "") =>
  cn(
    "h-9 rounded-input border border-border bg-surface px-3 text-[13px] text-text outline-none",
    "placeholder:text-muted focus:border-accent/60",
    extra,
  );

// Color-based hover/disabled, never `opacity` (which flickers in WKWebView).
const btnAccent = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3.5 text-[13px] font-medium",
    "text-accent-fg transition-colors hover:bg-accent/90 disabled:bg-accent/50",
    extra,
  );
