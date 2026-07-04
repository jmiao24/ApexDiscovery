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

## See it in action

**One prompt → a complete, traceable analysis.** Simulate data, fit a model, save a
publication-grade figure, and write a report where every number traces to the code.

![End-to-end dose–response analysis: the agent runs code and produces a fitted figure and a report](./docs/assets/showcase-workflow.webp)

**Every artifact traces back to its code, inputs, and conversation** — one click on a
figure reveals the script that made it and the versions behind it.

![Artifact inspector showing a figure's generating code, inputs, and provenance](./docs/assets/showcase-provenance.webp)

**Literature → verifiable report.** Search papers, draft a manuscript rendered as a
PDF, and audit it for citations, unsourced numbers, and figure↔code consistency.

![Literature survey producing a rendered PDF manuscript with a traceability review](./docs/assets/showcase-literature.webp)

<details>
<summary><b>More screenshots</b> — notebooks, experiment sweeps, and the skills library</summary>

<br>

**Conversation-first notebooks.** The agent drives a real Jupyter kernel; cells and
figures appear live beside the chat.

![The agent driving a Jupyter notebook with a live matplotlib figure](./docs/assets/showcase-notebook.webp)

**Run and track experiments.** Sweep parameters, keep a persistent kernel, and surface
results as traceable artifacts.

![An experiment sweep table alongside a live analysis notebook](./docs/assets/showcase-experiment.webp)

**Pluggable scientific skills.** Bundled skills for literature, experiments, figures,
and integrity — plus one-click open-source connectors and bring-your-own.

![The skills library listing bundled scientific skills](./docs/assets/showcase-skills.webp)

</details>

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
