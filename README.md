<div align="center">

[![APEX Discovery — Local-first AI research workbench](./docs/assets/banner.webp)](https://github.com/ai4s-research/open-science)

# APEX Discovery

**Local-first AI research workbench in your browser, powered by OpenAI Codex.**

APEX Discovery runs as a local process and opens the normal browser—no desktop
webview and no APEX account. Bring an OpenAI API key; projects, skills, plugins,
MCP tools, files, runs, and provenance remain local. The legacy Tauri shell is
still available for existing users.

<p>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://internscience.github.io/ResearchClawBench-Home/"><img src="https://img.shields.io/badge/%F0%9F%8F%86%20%231-ResearchClawBench-FFB300" alt="#1 on ResearchClawBench"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/UI-local%20browser-24C8DB" alt="Local browser UI">
  <img src="https://img.shields.io/badge/runtime-OpenAI%20Codex-success" alt="OpenAI Codex runtime">
  <a href="https://discord.gg/fWNMDKcd5P"><img src="https://img.shields.io/badge/Join-Discord-5865F2" alt="Join Discord"></a>
  <a href="http://makeapullrequest.com"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://linux.do"><img src="https://img.shields.io/badge/Join-linux.do-orange" alt="linux.do"></a>
</p>

</div>

---

🎉 **Recognition:** APEX Discovery Desktop ranks #1 by scored-task average on [ResearchClawBench](https://internscience.github.io/ResearchClawBench-Home/), an end-to-end benchmark for autonomous scientific research agents (Pass@1 leaderboard, July 9, 2026).

---

## Contents

- [✨ What it does](#what-it-does)
- [🎬 See it in action](#see-it-in-action)
- [🧪 Current capabilities](#current-capabilities)
- [🔌 Skills and connectors](#skills-and-connectors)
- [📦 Install](#install)
- [🚀 Build from source](#build-from-source)
- [🔒 Safety and privacy](#safety-and-privacy)
- [🗂️ Repository layout](#repository-layout)
- [📌 Status](#status)
- [🤝 Contributing](#contributing)
- [📖 Citation](#citation)
- [⚖️ License](#license)

## What it does

**Runs the whole research loop** — from a broad direction to a finished paper:
exploration, literature survey, hypothesis, experiment code, analysis, figures, and
write-up, in one continuous, auditable session.

- **Autonomous research agents** — the bundled `ai4s-agent` chains specialist skills
  end to end (explore → survey → experiment → write), and each stage drops a real,
  inspectable artifact into your workspace, not just a chat reply.
- **Everything traces back** — figures, tables, reports, notebooks, and run outputs
  link to the exact code, inputs, environment, model output, and conversation that
  produced them.
- **Local-first and yours** — sessions, data, provenance, notebooks, and run records
  live in local folders on your machine. Nothing leaves by default.
- **Model-agnostic runtime** — the UI talks through `packages/sdk` to a bundled,
  pinned OpenCode sidecar. Bring your own model; providers, skills, and MCP servers
  stay pluggable.
- **Reproducible by construction** — local, SSH/Slurm, Modal, and notebook-batch runs
  are captured as reproducible run records, not loose terminal scrollback.
- **Extensible** — agent skills, MCP servers and one-click science connectors,
  `/` commands, `!` shell mode, and a model-agnostic SDK.

## See it in action

**One prompt -> a complete, traceable analysis.** Simulate data, fit a model, save a
publication-grade figure, and write a report where every number traces to the code.

![End-to-end dose-response analysis: the agent runs code and produces a fitted figure and a report](./docs/assets/showcase-workflow.webp)

**Every artifact traces back to its code, inputs, and conversation.**

![Artifact inspector showing a figure's generating code, inputs, and provenance](./docs/assets/showcase-provenance.webp)

**Literature -> verifiable report.** Search papers, draft a manuscript rendered as a
PDF, and audit citations, unsourced numbers, and figure/code consistency.

![Literature survey producing a rendered PDF manuscript with a traceability review](./docs/assets/showcase-literature.webp)

<details>
<summary><b>More screenshots</b></summary>

<br>

![The agent driving a Jupyter notebook with a live matplotlib figure](./docs/assets/showcase-notebook.webp)

![An experiment sweep table alongside a live analysis notebook](./docs/assets/showcase-experiment.webp)

![The skills library listing bundled scientific skills](./docs/assets/showcase-skills.webp)

</details>

## Current capabilities

**The research loop, as skills.** One meta-skill runs the full pipeline; each stage
is a self-contained skill that produces a real, gradeable artifact — runnable on any
model OpenCode supports:

| Skill | Role | Primary output |
| --- | --- | --- |
| `ai4s-agent` | Runs the four skills below, in order | The full research package |
| `research-explorer` | Turn a broad direction into concrete topics | `research_exploration.md`, `topic_matrix.md`, `literature_pre_survey.md` |
| `literature-survey` | Write a literature survey | 6–20 pp PDF, 60+ real citations, LaTeX source, taxonomy figures |
| `experiment-suite` | Build an experiment package | Design doc, runnable code, `results.json` with provenance, figures, report |
| `paper-writer` | Write a research paper | 8–14 pp PDF, 200+ citations, 4–8 figures, tables |
| `mindmap-render` | Render a mindmap | Image generated from a `topic_matrix.md` |
| `integrity-auditor` | Audit a paper's integrity | Image / numerical / logical findings, 4-level evidence grading, `audit_report.md` |

These ship in the `ai4s-skills` pack alongside first-party review skills and the
office/document skills below.

### Platform

| Area | Current state |
| --- | --- |
| Browser shell | One local Rust process opens the normal browser on macOS, Windows, or Linux; the legacy Tauri shell remains available. |
| Runtime | Bundled Codex bridge and pinned Codex runtime, isolated in app-private config/data. |
| Sessions | Multi-session chat/history, dated workspace folders, global history across workspaces, `/` commands, and `!` shell mode. |
| Agents | Explicit requests such as “launch a literature subagent to…” or `$literature-agent …` create a separate read-only Codex thread, stream its child-session activity under the Main task, and return its evidence memo to Main for synthesis. |
| Files | Global and per-session file browsing, context menu actions, external open/reveal, copy path, and local preview server. |
| Notebooks | `.ipynb` artifacts render in the built-in viewer with local kernel execution; the agent drives a managed Jupyter environment (bundled `uv`) via MCP. |
| Runs | Append-only run logs, global SQLite run index, search/facets/pagination, local/remote surfaces, output links, logs, and reproduce prompts. |
| Provenance | `.openscience/provenance.jsonl` tracks file versions and links produced artifacts back to the run or edit that created them. |
| Review | A task-level **Review** button starts a fresh, read-only Reviewer thread on demand. It loads the applicable traceability/statistics skills, returns actionable findings to the original Main Agent once, then performs one independent re-review. Nothing runs automatically. |
| Viewers | PDF, image, video, HTML, Markdown, code, CSV/TSV tables with charts, DOCX, XLSX, PPTX, molecules, 3D meshes, genome tracks, FITS, DOS/DOSCAR, EIGENVAL bands, qcode, anomaly maps, and phase files. |
| Models | OpenAI Codex via a user-provided API key in the browser distribution; legacy runtimes remain available to developers. |
| Interface language | English. |

## Skills and connectors

Bundled skills are fetched for builds and releases instead of being committed into
git history:

- `ai4s-skills` pack from `ai4s-research/ai4s-skills`.
- Office/document skills from the Apache-2.0 `anthropics/skills` repository:
  `docx`, `pdf`, `pptx`, and `xlsx`.
- First-party core skills in `runtime/skills/core/`:
  `traceability-review`, `stats-integrity`, `large-file`,
  `publication-figures`, `remote-compute`, `modal-run`, and `open-targets`.

One-click science MCP connectors currently include:

- Literature search: arXiv, PubMed, Crossref, Semantic Scholar, bioRxiv/medRxiv.
- Biomedical databases: PubMed, ClinicalTrials.gov, MyVariant/ClinVar.
- Materials Project.
- FRED economic data.
- Space weather.
- Open-Meteo weather and climate.
- USGS water data.

You can also add any local or remote MCP server from Settings. See
[`docs/CONNECT_YOUR_TOOLS.md`](./docs/CONNECT_YOUR_TOOLS.md).

For a neutral positioning note, see
[`APEX Discovery Desktop vs OpenScience`](./docs/open-science-desktop-vs-openscience.md).

## Install

For the browser edition, download `apexscience-browser-<platform>` from the
Releases page and extract it. No Node, Rust, Docker, or desktop app is required.

- macOS: double-click `APEX Discovery.command`, or run `./apexscience`.
- Windows: double-click `APEX Discovery.cmd`.
- Linux: run `./apexscience`.

The browser bundles are not code-signed yet. If macOS quarantines the extracted
folder, run `xattr -cr apexscience-browser` once before launching it.

The launcher opens a random localhost port and exchanges a one-time nonce for
an HttpOnly session cookie. There is no APEX sign-in. Supply `OPENAI_API_KEY` in
the launch environment, or enter the key in Settings for the current run.

The release workflow produces self-contained arm64 and Intel macOS bundles,
Windows x64, and Linux x64 bundles, and attaches them to tagged releases.

### Legacy desktop installers

Download the latest installer from the
[Releases page](https://github.com/ai4s-research/open-science/releases/latest).

- **macOS**: `.dmg` / `.app`, Apple Silicon and Intel, macOS 13 Ventura or later.
- **Windows**: NSIS `.exe` and `.msi`, Windows 10/11 x64.
- **Linux**: `.deb` and `.rpm` on x86_64 Linux.

Builds are not code-signed or notarized yet.

**macOS**: if Gatekeeper says the app is damaged or from an unidentified developer,
install it into Applications and run:

```bash
xattr -cr "/Applications/APEX Discovery.app"
```

**Windows**: if SmartScreen appears, choose **More info -> Run anyway**.

**Linux**:

```bash
sudo apt install ./OpenScience_*.deb
# or
sudo rpm -i OpenScience_*.rpm
```

## Self-hosted web version

The same workbench, served to the normal browser by one local process. A local
launch binds an automatic loopback port, opens the browser with a one-time
nonce, exchanges it for an HttpOnly session cookie, and removes the nonce from
the URL. There is no APEX account or token-entry step in this localhost flow.

For a Docker/LAN deployment, keep the separate browser access token: binding a
command- and filesystem-capable agent to a non-loopback interface without
access control is unsafe.

```bash
APEX_TOKEN=<browser-token> OPENAI_API_KEY=<your-key> docker compose up -d
# open http://localhost:3411 and sign in with the token
```

Or without Docker: build the frontend (`pnpm --filter @ai4s/desktop build`),
then set `OPENAI_API_KEY` and run
`cargo run --release --manifest-path apps/server/Cargo.toml` — the browser opens
automatically. Run
`apexscience-server --help` for the flags (data dir, opencode binary, bind
host/port). The server binds `127.0.0.1` by default; to expose it beyond
localhost, pass `--host 0.0.0.0` and terminate TLS in a reverse proxy in
front. The browser only holds an HttpOnly session cookie. Provider keys and the
agent-runtime password stay in the local server/sidecar process.

### Claude Agent SDK backend (experimental)

`apps/claude-bridge/` is a drop-in replacement for the OpenCode sidecar that
runs the agent on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)
instead: a small Node server speaking the same HTTP+SSE wire subset the
frontend consumes, and accepting the same CLI/env contract as `opencode serve`
— so neither the frontend nor the Rust server changes. Product deployments use
`ANTHROPIC_API_KEY` and honor the app's approval mode (the approve switch maps
to the SDK's permission callback). An existing Claude CLI subscription is only
supported as an explicitly enabled personal local-testing mode.

```bash
pnpm install   # installs @anthropic-ai/claude-agent-sdk for the bridge
APEX_TOKEN=<token> APEX_OPENCODE_BIN=$PWD/apps/claude-bridge/src/server.mjs \
  cargo run --release --manifest-path apps/server/Cargo.toml
```

Chat with streaming, tool activity (bash/write/edit rows), tool approvals,
session history/resume, `!` shell mode, and model selection (Sonnet/Opus/Haiku)
work; OpenCode-specific surfaces (multi-provider OAuth catalog, MCP management,
slash-command discovery) are stubbed. Provenance, runs, files, and git
snapshots are backend-independent and work unchanged.

### OpenAI Codex backend (experimental)

`apps/codex-bridge/` is the same idea on the
[OpenAI Codex SDK](https://developers.openai.com/codex/sdk): same wire subset,
same drop-in sidecar contract. For the browser distribution, provide
`OPENAI_API_KEY`; it stays in process memory and is not written to the bridge's
JSON configuration. The bridge uses an app-private `CODEX_HOME`.

```bash
OPENAI_API_KEY=<key> APEX_OPENCODE_BIN=$PWD/apps/codex-bridge/src/server.mjs \
  cargo run --release --manifest-path apps/server/Cargo.toml
```

For the current local APEX Discovery development build, launch the prebuilt
server and frontend with a fixed browser port and access token:

```bash
cd /Users/jiachengmiao/Desktop/APEX_Science/ApexScience

CODEX_HOME="$HOME/.codex" \
APEX_CLAUDE_AUTH=subscription \
APEX_CLAUDE_EXECUTABLE="$HOME/.local/bin/claude" \
APEX_OPENCODE_BIN="$PWD/apps/codex-bridge/src/server.mjs" \
apps/server/target/release/apexscience-server \
  --port 49369 \
  --token apex-demo \
  --frontend-dir "$PWD/apps/desktop/dist"
```

Open `http://127.0.0.1:49369/` and use `apex-demo` if the browser asks for the
access token. This command uses Claude CLI subscription authentication only for
explicitly launched Claude child agents; the Main Agent continues to use Codex.

The bridge discovers Codex-native repository/user skills (`.agents/skills`),
loads enabled plugin skills, maps local and remote MCP servers into Codex
configuration, and streams MCP arguments/results/errors into the tool log.
The Extensions page installs a local plugin directory or HTTPS Git repository,
validates `.codex-plugin/plugin.json`, shows skills/MCP/scripts/hooks, and keeps
new installs and updates disabled until reviewed. Remote catalogs should pin an
expected commit.

Subagent paths are explicit and bounded. Asking to launch a **literature
subagent** creates a separate Codex thread with the Main Agent's APEX tools,
skills, MCP servers, and current permission mode, but nested subagent launch is
disabled. The Main Agent also has a `LaunchClaudeAgent` tool backed by the
Claude Agent SDK. A Claude child receives the same APEX capability catalog,
runs in a separate persisted child session with live activity, and returns its
memo to the Main thread; it likewise cannot launch another child.

Production Claude children use `ANTHROPIC_API_KEY`. For personal local testing
only, an already authenticated Claude CLI subscription can be selected
explicitly with `APEX_CLAUDE_AUTH=subscription`; this mode is never inferred or
exposed as an end-user login flow. `APEX_CLAUDE_EXECUTABLE` can override the
local CLI path and `APEX_CLAUDE_MODEL` can select a Claude model. Ordinary
mentions of agents do not trigger delegation: the Main Agent must invoke the
dedicated tool.

When a turn creates or changes a reviewable artifact (code, notebook, data,
report, or figure), the bridge remembers the review targets but does nothing in
the background. Clicking **Review** in the task composer starts a fresh Codex
thread in a read-only filesystem sandbox. That Reviewer loads the applicable bundled
`traceability-review` and `stats-integrity` skills. Actionable
findings are returned once to the original Main Agent for correction, followed
by one final independent re-review. Reviewer threads receive no MCP servers, so
they cannot mutate external systems through a connector; network access is kept
for citation verification. Settings controls whether a manually started review
may perform the one bounded fix/re-review cycle. Each phase is persisted in the
task timeline.

Codex sandboxes agent commands: approve maps to `workspace-write`, full maps to
`danger-full-access`. Direct `!` shell execution is disabled in approve mode
because it bypasses Codex's sandbox. MCP tools default to the conservative
`writes` approval policy; the current TypeScript SDK transport cannot relay
interactive approval callbacks to the browser. Plan-first routing remains
ignored.

## Build from source

Prerequisites for development:

- Node.js >= 20
- pnpm 9
- Rust toolchain
- macOS, Windows, or Linux system dependencies required by Tauri

```bash
git clone https://github.com/ai4s-research/open-science
cd open-science
pnpm install

# Fetch pinned sidecars and bundled skills. These are git-ignored.
bash scripts/dev/fetch-opencode.sh
bash scripts/dev/fetch-uv.sh
bash scripts/dev/fetch-skills.sh

# Run in development or build installers.
OPENAI_API_KEY=<key> cargo run --release --manifest-path apps/server/Cargo.toml
pnpm --filter @ai4s/desktop tauri dev
pnpm --filter @ai4s/desktop tauri build
```

Useful checks:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## Safety and privacy

- Workspace files, raw data, session history, provenance, notebooks, and run records
  stay local by default.
- Browser-edition agent commands use Codex's workspace sandbox by default;
  unrestricted Full mode is an explicit user choice. Plugins install disabled.
- The OpenAI key stays in the server/bridge process and is not written to the
  workspace, provenance, git, exports, or bridge JSON configuration.
- Settings includes a plain-language data-flow view explaining what can be sent to
  the selected model provider.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Shared React frontend plus the legacy Tauri shell. |
| `apps/server/` | Axum server for the self-hosted web version. |
| `apps/codex-bridge/` | OpenCode-wire-compatible bridge to the OpenAI Codex SDK. |
| `crates/shell-core/` | Shared Rust command core (desktop + web server). |
| `packages/sdk/` | `OpenCodeClient`; keeps the UI from calling OpenCode directly. |
| `packages/shared/` | Shared domain types and chart palette. |
| `packages/ui/` | Shared UI package. |
| `runtime/skills/core/` | First-party scientific skills. |
| `runtime/skills/external/` | Build-fetched external skills. |
| `runtime/harness/` | Runtime harness knowledge and operator context. |
| `runtime/mcp/` | MCP runtime notes/configuration. |
| `examples/` | Built-in example workspaces. |
| `scripts/dev/` | Sidecar, `uv`, skill fetchers, and focused regression probes. |
| `scripts/release/` | Self-contained browser release assembler. |
| `docs/` | Product, technical, operator, connector, and research notes. |

## Status

The project is a working desktop MVP in active development. The most reliable current
implementation log is [`PROGRESS.md`](./PROGRESS.md). Product and architecture notes
live in [`docs/PRD.md`](./docs/PRD.md) and
[`docs/TECHNICAL_DESIGN.md`](./docs/TECHNICAL_DESIGN.md), but those documents include
target design as well as historical status notes.

Near-term work is focused on signed/notarized releases, broader Windows/Linux
verification, auto-update, richer connector hardening, and continued reproducibility
review.

## Contributing

Issues and PRs are welcome. Keep changes minimal and verifiable, follow
[`AGENTS.md`](./AGENTS.md), and run the checks before opening a PR. For discussion,
join the [APEX Discovery Discord](https://discord.gg/fWNMDKcd5P) or the
[linux.do](https://linux.do) community.

## Citation

If you use APEX Discovery Desktop in your research, please cite it:

```bibtex
@software{open_science_desktop,
  author  = {{The APEX Discovery Desktop Contributors}},
  title   = {APEX Discovery Desktop: a local-first, model-agnostic AI research workbench},
  year    = {2026},
  version = {0.1.9},
  url     = {https://github.com/ai4s-research/open-science},
  license = {MIT}
}
```

GitHub's **"Cite this repository"** button (top of the repo page, generated from
[`CITATION.cff`](./CITATION.cff)) provides the same reference in APA and BibTeX.

## License

[MIT](./LICENSE). Bundled third-party skills and connectors keep their own licenses.

> APEX Discovery Desktop is beta research tooling. Treat outputs as drafts: verify numbers,
> citations, code, and conclusions before publication or decision-making.
