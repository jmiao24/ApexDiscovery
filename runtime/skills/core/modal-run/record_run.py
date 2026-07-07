#!/usr/bin/env python3
"""Record a remote (HPC/Modal) experiment run into the Open Science provenance.

Remote runs execute off the laptop, so the app can't capture their environment,
hardware, or outputs. This helper — called by the hpc-slurm / modal-run skills
AFTER a job completes and its results are fetched — appends an accurate run
record to <workspace>/.openscience/remote-runs.jsonl, which the app merges into
the Runs view. It owns the record schema so the agent never hand-writes JSON.

Usage (run from the workspace root):
  python record_run.py --surface hpc --command "sbatch train.slurm" \
      --status ok --host login-a --job-id 12345 \
      --hardware "1x A100 (node gpu-07), CUDA 12.2" --wall-ms 3600000 \
      --code slurm/train.sbatch --output slurm/train/result.csv
"""
import argparse
import hashlib
import json
import os
import sys
import time

STORE = os.path.join(".openscience", "remote-runs.jsonl")
HASH_CAP = 5_000_000  # bytes; larger files are recorded by size only


def artifact(path):
    """A {path, hash?, size} record for a workspace file (size 0 if missing)."""
    rec = {"path": path.replace(os.sep, "/")}
    try:
        size = os.path.getsize(path)
        rec["size"] = size
        if 0 < size <= HASH_CAP:
            with open(path, "rb") as f:
                rec["hash"] = hashlib.sha1(f.read()).hexdigest()[:16]
    except OSError:
        rec["size"] = 0
    return rec


def main():
    p = argparse.ArgumentParser(description="Record a remote run into Open Science provenance.")
    p.add_argument("--command", required=True, help="the submit command, e.g. 'sbatch train.slurm'")
    p.add_argument("--surface", required=True, choices=["hpc", "modal"], help="compute surface")
    p.add_argument("--status", default="ok", choices=["ok", "failed"], help="terminal outcome")
    p.add_argument("--host", help="cluster host / Modal app the run executed on")
    p.add_argument("--job-id", dest="job_id", help="scheduler job id / Modal call id")
    p.add_argument("--hardware", help="remote hardware, e.g. '1x A100 (node gpu-07), CUDA 12.2'")
    p.add_argument("--wall-ms", dest="wall_ms", type=int, help="wall-clock duration in milliseconds")
    p.add_argument("--code", action="append", default=[], help="entry script(s), repeatable")
    p.add_argument("--output", action="append", default=[], help="fetched output file(s), repeatable")
    p.add_argument("--session-id", dest="session_id", help="originating conversation id")
    args = p.parse_args()

    ts = int(time.time())
    run_id = "run_" + hashlib.sha1(f"{time.time_ns()}:{args.command}".encode()).hexdigest()[:16]

    record = {
        "runId": run_id,
        "ts": ts,
        "command": args.command,
        "surface": args.surface,
        "status": args.status,
        "code": [artifact(c) for c in args.code],
        "outputs": [artifact(o) for o in args.output],
    }
    for key, val in (
        ("host", args.host),
        ("jobId", args.job_id),
        ("remoteHardware", args.hardware),
        ("wallMs", args.wall_ms),
        ("sessionId", args.session_id),
    ):
        if val is not None:
            record[key] = val

    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    with open(STORE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    print(f"Recorded {args.surface} run {run_id} ({args.status}) → {STORE}", file=sys.stderr)


if __name__ == "__main__":
    main()
