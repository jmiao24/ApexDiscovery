![Open Science — An open AI workbench for scientists](./docs/assets/banner.webp)

# Open Science

> **An open AI workbench for scientists.** Your research partner for rigorous science.

An open-source, **local-first**, **model-agnostic**, **reproducible** AI research
workbench for macOS and Windows — an **open-source alternative to Claude Science**
(Claude for Science) and similar AI-for-science products. It is not a chat box: it is a workbench that ties literature,
code, figures, reports, and review into one auditable, reproducible workflow.

Built on [Tauri 2](https://tauri.app), the [OpenCode](https://opencode.ai) agent
runtime (bundled as a sidecar), MCP, scientific skills, and an artifact provenance system.

## Why it is different

- **A workbench, not a chat box** — plan → approve → execute → artifacts → review.
- **Traceable artifacts, not just text** — every figure, table, and report links
  back to its code, data, and steps.
- **Model-agnostic** — BYOK via OpenRouter, OpenAI-compatible, Anthropic, or local models.
- **Reproducible** — code, data, figures, reports, logs, and `provenance.jsonl` are kept.
- **Multi-domain** — starting with AI4S, expanding to materials, chemistry, biology,
  medicine, and engineering.

## Status

`v0.1` in development — desktop MVP. See [`PROGRESS.md`](./PROGRESS.md) for the log
and [`docs/PRD.md`](./docs/PRD.md) / [`docs/TECHNICAL_DESIGN.md`](./docs/TECHNICAL_DESIGN.md)
for the full spec.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Tauri 2 + React + TypeScript + Vite desktop shell (`src/` frontend, `src-tauri/` Rust) |
| `packages/ui/` | Shared UI component library |
| `packages/shared/` | Shared types and utilities |
| `packages/sdk/` | `OpenCodeClient` SDK wrapper (isolates the UI from the runtime) |
| `runtime/manager/` | Local Runtime Manager: dependency checks, sidecar lifecycle, workspace, provenance |
| `runtime/opencode-profile/` | The Open Science OpenCode profile (config + skills) |
| `runtime/mcp/` | MCP server configurations (filesystem, paper-search, BioMCP, Zotero, …) |
| `runtime/skills/` | Self-authored scientific skills (`core/`) |
| `docs/` | `PRD.md`, `TECHNICAL_DESIGN.md` |
| `examples/bci-trends/` | The built-in end-to-end demo project workspace |
| `scripts/` | `release/` and `dev/` scripts |

## Core principles

1. **Local-first** — projects, corpora, figures, reports, and logs live in a local workspace.
2. **Model-agnostic** — no lock-in to any single model or provider.
3. **Reproducibility-first** — every important artifact is traceable to its inputs.
4. **Human-in-the-loop** — file writes, command execution, network access, and other
   high-risk actions require approval.

## Getting started

Build tooling is not yet scaffolded (this is the initial skeleton). Planned entry points:

```bash
# planned
pnpm install
pnpm --filter desktop tauri dev     # run the desktop app in dev
pnpm --filter desktop tauri build   # produce installers (.dmg / .app / NSIS / .msi)
```

## License

[MIT](./LICENSE). Third-party scientific skills carry their own licenses.
