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
runs **one** non-interactive SSH round-trip that prints machine-readable lines,
parsed defensively (unrecognized lines — e.g. shell banners — are ignored):

```
uname -sr
nproc
free -b | awk '/^Mem:/{print $2}'
command -v sbatch >/dev/null 2>&1 && sbatch --version 2>/dev/null | head -1
command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
```

Capabilities are detected **live** on every probe, never persisted — GPU/CPU
availability changes over time.

Backend probe result:

```rust
struct ComputeProbe {
    reachable: bool,
    message: Option<String>,   // failure/hint detail when not reachable
    os: Option<String>,        // uname -sr
    cores: Option<u32>,        // nproc
    mem_bytes: Option<u64>,    // total RAM in bytes (UI formats it)
    gpus: Vec<GpuInfo>,        // empty when none
    slurm: Option<String>,     // sbatch --version line when present
}
struct GpuInfo { name: String, mem_total: String }
```

Reachability vs. errors follow the current `hpc_check` logic: SSH exit 255 =
unreachable (with the host-key-verification hint preserved); otherwise reachable
and we report whatever capabilities were found.

### 2. Data model

Rename `.openscience/hpc.json` → `.openscience/compute.json`, holding a list:

```json
{ "machines": [ { "host": "home-3090", "label": "8×3090" } ] }
```

- `host` — `user@host` or an `~/.ssh/config` alias (validated by the existing
  `is_safe_host`).
- `label` — optional display name; defaults to `host`.

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
2. Pick the machine by task need (GPU vs CPU-only) and detected capabilities;
   ask the user when ambiguous or when several fit.
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
  - capability chips: e.g. `16 cores · 64 GB · 8× RTX 3090`, or
    `8 cores · 32 GB`, or `Slurm 23.11` — or the failure message,
  - refresh (re-probe) and remove.
  - Slurm hosts: an expandable Slurm queue view (the current `squeue` table +
    cancel), shown only when Slurm is detected.

No red "Could not read the queue" error for non-Slurm hosts — there is no queue
to read; the row simply shows capabilities.

### 6. Backend commands (Tauri)

- `compute_machines() -> Vec<Machine>` — read `compute.json` (with migration).
- `add_compute_machine(host, label?)` / `remove_compute_machine(host)`.
- `compute_probe(host) -> ComputeProbe` — replaces `hpc_check`.
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

**v1:** everything in §§1–6.

**Deferred:** non-Slurm running-jobs panel in the card, live GPU-utilization
view, tmux attach.

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

- Rust unit tests: probe-output parsing (cores/mem/gpus/slurm from the labeled
  lines, incl. banner-line noise), `compute.json` read + `hpc.json` migration,
  retained `is_safe_host`/`is_safe_job_id`/`parse_squeue` tests.
- Frontend: RemoteComputeCard — capability chips render; a reachable no-Slurm
  host shows capabilities and no queue error; a Slurm host shows the queue;
  add/remove/refresh; multiple machines listed.
- The existing "skips the queue read for a reachable host without Slurm" test
  carries over.
