# Remote compute over SSH — design

Date: 2026-07-07
Status: approved (brainstorm), pending implementation plan

## Motivation

The existing **Cluster (HPC)** feature only works with Slurm clusters: it probes
for `sbatch`, and the agent's `hpc-slurm` skill submits batch scripts via
`sbatch`/`squeue`/`sacct`/`scancel`. A user connected a plain 8-GPU workstation
(`home-3090`) and hit two failures — "connected, but `sbatch` was not found" and
"Could not read the queue" — because the host has no Slurm at all (verified over
SSH: no `sbatch`/`squeue`/`scancel`, no slurm package or service).

That is a scope mistake, not a technical limit. A single dedicated server —
GPU **or** CPU-only — is a common, valid compute target that needs no scheduler:
you SSH in and run the command. This design generalizes the feature to **any
reachable SSH machine**, with Slurm demoted to an optional capability.

## Goals

- Connect **any** machine the user can reach over SSH (their own keys/config).
  The only requirement is SSH reachability — not GPU, not Slurm.
- Support **multiple** saved machines (e.g. a GPU box and a CPU analysis box);
  the agent picks the right one per task by its detected capabilities.
- Show what each machine **has**: OS, CPU cores, RAM, GPUs (if any), Slurm (if
  any).
- Let the agent run **long-running jobs** on a non-Slurm machine robustly:
  launch detached, monitor, cancel, fetch results, record the run — mirroring
  the Slurm lifecycle.
- Preserve the existing Slurm path unchanged for real clusters.

## Non-goals (deferred past v1)

- A live "running jobs" panel in the card for non-Slurm hosts (the agent reports
  job status in chat for v1).
- Live GPU-utilization view in the card.
- `tmux`/`screen` attach for a live remote terminal.
- Auto-provisioning / installing anything on the remote machine.

## Design

### 1. Connection requirement & capability detection

Connecting requires only that SSH succeeds. On connect (and on refresh) the app
runs **one** non-interactive SSH round-trip that prints token-labeled lines,
parsed by first token and defensively (unrecognized/missing lines — e.g. shell
banners, or `free`/`nvidia-smi` absent — are simply skipped). Target is a Linux
remote; missing tools degrade gracefully rather than fail. The probe gathers
both static identity **and** a current-usage snapshot in the one round-trip:

```sh
echo "OS $(uname -sr)"
echo "CORES $(nproc)"
cut -d' ' -f1 /proc/loadavg | sed 's/^/LOAD /'                       # 1-min load
free -b | awk '/^Mem:/{print "MEMTOTAL",$2; print "MEMAVAIL",$7}'
df -PB1 "$HOME" | awk 'NR==2{print "DISKTOTAL",$2; print "DISKFREE",$4}'
command -v sbatch  >/dev/null 2>&1 && echo "SLURM $(sbatch --version | head -1)"
command -v nvidia-smi >/dev/null 2>&1 && \
  nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu \
             --format=csv,noheader,nounits | sed 's/^/GPU /'
```

Everything is re-read on every probe; nothing time-varying is persisted (see
§2 for the small static cache used only for agent machine-selection).

Backend probe result:

```rust
struct ComputeProbe {
    reachable: bool,
    message: Option<String>,        // failure/hint detail when not reachable
    os: Option<String>,             // uname -sr
    cores: Option<u32>,             // nproc
    load1: Option<f32>,             // 1-min load average (vs. cores = how busy)
    mem_total_bytes: Option<u64>,
    mem_avail_bytes: Option<u64>,   // "available" — used = total - avail
    disk_total_bytes: Option<u64>,  // $HOME filesystem (where jobs run)
    disk_free_bytes: Option<u64>,
    gpus: Vec<GpuInfo>,             // empty when none
    slurm: Option<String>,          // sbatch --version line when present
}
struct GpuInfo { name: String, mem_total_mib: u64, mem_used_mib: u64, util_pct: u32 }
```

Reachability vs. errors follow the current `hpc_check` logic: SSH exit 255 =
unreachable (with the host-key-verification hint preserved); otherwise reachable
and we report whatever capabilities were found.

### 2. Data model

Rename `.openscience/hpc.json` → `.openscience/compute.json`, holding a list:

```json
{
  "machines": [
    {
      "host": "home-3090",
      "label": "8×3090",
      "caps": { "cores": 16, "mem_total_bytes": 67516000000,
                "gpus": ["RTX 3090", "RTX 3090"], "slurm": null }
    }
  ]
}
```

- `host` — `user@host` or an `~/.ssh/config` alias (validated by the existing
  `is_safe_host`).
- `label` — optional display name; defaults to `host`.
- `caps` — a small **static** capability cache (cores, total RAM, GPU model
  names, Slurm version-or-null) written whenever the app probes the machine.
  Its sole purpose is to let the agent skill **pick a machine** (GPU task → a
  box with GPUs; CPU task → any) by reading the file, without SSH-probing every
  machine itself. Time-varying usage (load, free memory/disk, GPU utilization)
  is **never** cached — the agent re-probes for that when it matters. `caps` is
  absent until the first successful probe.

**Migration:** on first read, if `compute.json` is absent but a legacy
`hpc.json` exists, import its single `{"host":...}` as one machine, write
`compute.json`, and remove the legacy file. The agent skill reads
`compute.json`.

### 3. Long-job execution model (agent, non-Slurm hosts)

Best-practice detached execution — universal (`setsid`/`nohup`/`ps` are
everywhere), robust to SSH disconnect, and mirroring the Slurm remote-dir +
id + output-file structure:

- Create a per-job dir on the remote: `openscience/jobs/<name>-<timestamp>/`.
- Write the command to `run.sh` in that dir.
- Launch fully detached:
  `setsid bash run.sh >log 2>&1 </dev/null & echo $! > pid`
  then record the **PID**, its **process group id (PGID)**, and a **start
  timestamp** in `meta.json`.
- On completion the launcher writes an `exit_code` sentinel
  (`... ; echo $? > exit_code`), so "finished / succeeded" is unambiguous and
  never inferred from `ps` alone.
- **Monitor:** `ps` on the PID (cross-checked against the recorded start time to
  survive PID reuse after a reboot) + `tail log`; for GPU jobs, `nvidia-smi`.
- **Cancel:** `kill` the whole process group (`kill -- -<pgid>`) so children die
  too — only jobs the agent launched, or a job id the user names.
- **Fetch:** `scp` outputs back into the workspace so they become traceable
  artifacts.
- **Record:** `record_run.py --surface ssh` with the hardware string from the
  probe (e.g. "8× RTX 3090" / "16 cores, 64 GB").

Slurm hosts keep the existing `sbatch` flow untouched.

### 4. Agent skill

Rename `hpc-slurm` → unified `remote-compute` skill. One entry point:

1. Read `compute.json`; if empty, point the user at Settings → Remote compute.
2. Pick the machine using each entry's `label` + cached `caps` (GPU task → a
   box with GPUs; CPU task → any). Ask the user when several fit or none is
   clearly right; never guess silently. Re-probe the chosen machine over SSH to
   confirm it's reachable and read live headroom before launching.
3. If the chosen machine has Slurm → existing `sbatch` batch-script flow.
4. Otherwise → the detached direct-SSH flow in §3.

`record_run.py` gains a `--surface ssh` path (alongside the existing `hpc`),
recording the hardware string rather than a package list.

### 5. Frontend — RemoteComputeCard

Replaces `ClusterCard`. Card title/copy generalized to "Remote compute — run
jobs on your own servers over SSH (CPU or GPU; Slurm optional)."

- **Add** row: SSH-target input with `~/.ssh/config` datalist (as today).
- **Machine list**, one row each:
  - status dot (reachable = ok; unreachable = error; checking = muted),
  - label + host,
  - **identity chips** (collapsed): e.g. `16 cores · 64 GB · 8× RTX 3090 ·
    1.2 TB free`, or `8 cores · 32 GB · 400 GB free`, or the failure message,
  - refresh (re-probe) and remove.
  - **Expandable detail**, one per machine (symmetric):
    - Slurm host → the Slurm **queue** (the current `squeue` table + cancel).
    - non-Slurm host → a **usage snapshot** from the last probe: CPU load vs.
      cores (e.g. `1.2 / 16`), memory used/total (`12 / 64 GB`), per-GPU
      utilization + memory (`RTX 3090 · 40% · 8.1 / 24 GB`), disk free/total.
      Refreshed on demand via the row's refresh button — **not** polled.

No red "Could not read the queue" error for non-Slurm hosts — there is no queue
to read; the machine shows its capabilities and a usage snapshot instead.

### 6. Backend commands (Tauri)

- `compute_machines() -> Vec<Machine>` — read `compute.json` (with migration).
- `add_compute_machine(host, label?)` (dedupes by `host`) /
  `remove_compute_machine(host)`.
- `compute_probe(host) -> ComputeProbe` — replaces `hpc_check`. On a reachable
  result it also writes the machine's static `caps` back into `compute.json`
  (the cache the agent selects by).
- `compute_jobs(host)` / `compute_cancel(host, job_id)` — renamed from
  `hpc_jobs` / `hpc_cancel`, keeping the Slurm `squeue`/`scancel` semantics
  (only called for Slurm hosts in v1).
- `run_ssh` helper reused as-is.

### Safety

Nothing new is opened. SSH command execution goes through the app's existing
approval mode (manual approval by default) exactly as other shell execution
does. The app installs nothing on the remote and handles no credentials — the
user's own SSH keys/config only. `is_safe_host` / `is_safe_job_id` validation is
retained.

## Scope

**v1:** everything in §§1–6, including the on-demand usage snapshot for
non-Slurm machines (§5).

**Deferred:** a live *running-jobs* panel in the card for non-Slurm hosts (the
agent reports job status in chat in v1); *continuous/auto-refreshing*
utilization (v1's snapshot updates only when the user hits refresh); `tmux`
attach for a live remote terminal.

## Affected files (indicative)

- `apps/desktop/src-tauri/src/hpc.rs` → renamed `compute.rs` (probe, machines
  list, migration).
- `apps/desktop/src-tauri/src/lib.rs` — command registration.
- `apps/desktop/src/lib/tauri.ts` — new bindings + `ComputeProbe`/`Machine` types.
- `apps/desktop/src/components/settings/ClusterCard.tsx` → `RemoteComputeCard.tsx`
  (+ its test).
- `apps/desktop/src/app/routes/SettingsPage.tsx` — use the new card.
- `runtime/skills/core/hpc-slurm/` → `runtime/skills/core/remote-compute/`
  (SKILL.md rewrite + `record_run.py` `--surface ssh`).

## Testing

- Rust unit tests: probe-output parsing — every token
  (`OS`/`CORES`/`LOAD`/`MEMTOTAL`/`MEMAVAIL`/`DISKTOTAL`/`DISKFREE`/`SLURM`/`GPU`),
  multi-GPU lines, and banner/garbage-line noise that must be ignored;
  `compute.json` read + `caps` round-trip + `hpc.json` migration; retained
  `is_safe_host`/`is_safe_job_id`/`parse_squeue` tests.
- Frontend: RemoteComputeCard — identity chips render (incl. disk-free); a
  reachable no-Slurm host shows chips + an expandable usage snapshot and **no**
  queue error; a Slurm host shows the queue; add/remove/refresh; multiple
  machines listed.
- The existing "skips the queue read for a reachable host without Slurm" test
  carries over (renamed for the new component).
