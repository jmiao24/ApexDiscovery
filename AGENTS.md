# APEX Discovery

Brand name: **APEX Discovery** — "Local-first, Codex-powered AI research
workbench for macOS, Windows & Linux." Bundle identifier stays `com.ai4s.workbench`
and internal `@ai4s/*` package names are unchanged.

Project rules and working context for AI agents (Claude Code, Cursor, Codex, etc.).
`CLAUDE.md` is a symlink to this file — edit only `AGENTS.md`.

## Design principles

Keep it **simple, explicit, clear, complete**.

- **Simple** — no over-engineering; if not necessary, do not add entities.
- **Explicit** — no ambiguity; no bugs.
- **Clear** — understandable at a glance.
- **Complete** — cover the key points; prioritize safety.

## What this project is

An open-source, local-first, Codex-powered, reproducible AI research workbench
for macOS, Windows, and Linux. See `README.md`, `docs/PRD.md`, and
`docs/TECHNICAL_DESIGN.md`.

Recommended stack: **Tauri 2 + React + TypeScript + Vite**, Tailwind + Radix UI,
the **OpenAI Codex app-server** behind the bundled APEX Runtime API bridge (HTTP + SSE),
local workspace + SQLite + JSONL provenance.

## Repository map

- `apps/desktop/` — Tauri + React desktop shell (`src/` frontend, `src-tauri/` Rust).
- `apps/server/` — Axum server for the self-hosted web version (same frontend).
- `crates/shell-core/` — shared Rust command core both shells call; put new
  command logic here, with thin wrappers in `src-tauri/` and `apps/server/`.
- `packages/` — `ui`, `shared`, `sdk` (the `ApexRuntimeClient` wrapper).
- `runtime/` — `manager`, `apex-runtime-profile`, `mcp`, `skills`.
- `docs/` — product and technical specs.
- `examples/bci-trends/` — the built-in demo project.
- `scripts/` — release and dev scripts.

## Architecture guardrails

- The UI never calls an agent SDK directly — it goes through `packages/sdk`
  (`ApexRuntimeClient`) and the versioned APEX Runtime API.
- Keep the frontend, desktop shell, and agent runtime decoupled.
- Skills and MCP servers must stay pluggable; the production agent backend is Codex.
- Keep the artifact schema and workflow templates stable and versioned.

## Safety defaults (non-negotiable for the desktop)

- The agent may only access the current workspace.
- Command execution, file deletion, dependency install, and remote connections
  require approval (manual approval mode by default — never ship `off`).
- API keys go to the OS keychain / credential manager; never into provenance,
  logs, crash reports, git, or exported projects.

## Working conventions

- Default working language for discussion is Chinese; **all project files and
  code are in English** (this is a pure-English project).
- One progress file: `PROGRESS.md`. Append one line per real milestone,
  `YYYY-MM-DD HH:MM` + a one-sentence conclusion, newest on top. Results and
  blockers only.
- Avoid adding new Markdown docs unless requested — too many docs become debt.
- Prefer minimal, verifiable changes; every step should produce a checkable result.
- Do not write inferences as verified facts; tie conclusions to code or data.
- New session workspaces are local git repos: the app initializes them and makes
  best-effort local commits after workspace file changes. Never set a remote or push.
