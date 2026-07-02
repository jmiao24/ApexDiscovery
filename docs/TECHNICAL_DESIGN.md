# AI4S Workbench Desktop — Technical Design

## 1. Technical goals

A high-performance, open-source research workbench with macOS / Windows installers.
Design priorities: fast startup; smooth UI; simple install; replaceable agent runtime;
local and sandboxed execution; MCP / skills / workflow support; artifact provenance;
extensibility to Jupyter, HPC, Modal, Docker, and remote servers.

## 2. Overall architecture

```text
AI4S Workbench Desktop
├── Desktop Shell: Tauri 2
├── Frontend: React + TypeScript + Vite
├── UI System: Tailwind CSS + Radix UI / shadcn-style components
├── Local Service: Rust commands + Node/Python sidecars
├── Agent Runtime: Hermes Agent
├── Agent Protocol: Hermes TUI Gateway JSON-RPC / OpenAI-compatible API Server
├── Skills Layer: AI4S skills + K-Dense scientific-agent-skills
├── MCP Layer: filesystem / paper-search / BioMCP / Zotero / GitHub / custom
├── Execution Layer: Hermes terminal backend + optional Jupyter Kernel Gateway
├── Storage: Local workspace + SQLite + JSONL provenance
└── Packaging: Tauri DMG / APP / NSIS / MSI
```

## 3. Tauri over Electron

### 3.1 Recommendation

v1 uses **Tauri 2 + React + TypeScript + Vite**. Not Electron.

Reasons: Tauri is lighter with smaller installers; it uses the OS-native WebView,
suited to tool-type desktop apps; it is cross-platform (macOS / Windows / Linux); it
allows any frontend framework; and a Rust backend is well-suited to local files,
security, process management, and sidecar orchestration. Tauri positions itself around
small, fast, secure cross-platform apps built from a single codebase.

### 3.2 When Electron might fit

If later needs arise — complex browser capabilities, a more mature desktop ecosystem,
identical embedded Chromium behavior, or many native Node.js modules — Electron could be
reconsidered. But AI4S Workbench's core is the workbench, files, agent, runtime, and
artifacts, which do not need Chromium-level capabilities, so Tauri fits better.

## 4. Frontend

### 4.1 Stack

React · TypeScript · Vite · Tailwind CSS · Radix UI · TanStack Query · Zustand ·
React Router · Monaco Editor · Markdown renderer · ECharts / Plotly / Observable Plot.

### 4.2 Module layout

```text
src/
  app/{routes,layout,providers}
  components/{sidebar,topbar,command-palette,cards,artifact-viewer,
             approval-dialog,tool-call-card,code-viewer,markdown-viewer}
  features/{onboarding,projects,chat,agent-runtime,literature,artifacts,
            provenance,review,skills,settings}
  lib/{api,events,store,theme}
```

### 4.3 UI performance strategy

Streaming chat render; virtualized log lists; lazy file tree; paginated CSV; chunked
large-Markdown render; on-demand figures; cached artifact previews; a unified agent
event bus; all heavy work off to sidecar / worker; the Tauri main process does system
capabilities only, not heavy computation.

## 5. Agent runtime

### 5.1 Recommendation

Use **Hermes**. It has CLI / TUI / API / ACP integration paths; supports MCP; supports
skills; supports multiple terminal backends; has approval / sandbox / session / memory
capabilities; and can serve as an open-source agent alternative to Claude Code.

Hermes offers three external protocols: ACP, TUI Gateway JSON-RPC, and an
OpenAI-compatible HTTP API Server. The TUI Gateway suits a custom desktop/web host
because it exposes sessions, slash commands, approvals, and streaming events.

### 5.2 Desktop ↔ Hermes communication

| Approach | Notes | Phase |
| --- | --- | --- |
| TUI Gateway JSON-RPC | Most complete; best for a custom desktop app | v0.1 |
| OpenAI-compatible API Server | Simple; quick chat wiring | v0.1 fallback |
| ACP | Best for IDE-type products | later |
| Python in-process | Heavy coupling; not for v1 | later |

v1 flow:

```text
Tauri App starts Hermes Gateway sidecar
↓
Frontend sends prompt via JSON-RPC / WebSocket
↓
Hermes returns message.delta / tool.start / approval.request / tool.complete
↓
Frontend renders streaming messages, tool cards, approval dialogs, artifact status
```

### 5.3 Hermes profile distribution

AI4S Workbench should not merely "call Hermes" — it should bundle a dedicated Hermes
profile distribution:

```text
distribution.yaml
SOUL.md
config.yaml
mcp.json
skills/
workflows/
templates/
```

A profile distribution packages personality, skills, cron jobs, MCP connections, and
config as a Git repo installable in one command — without carrying the user's own
memories, sessions, or API keys.

## 6. Skills & MCP

### 6.1 Skill layering

```text
skills/
  core/      # reproducible-research, literature-review, figure-provenance,
             # citation-reviewer, paper-to-report
  external/  # K-Dense scientific-agent-skills
  user/      # custom skills
```

### 6.2 v1 built-in skills

| Skill | Purpose |
| --- | --- |
| `reproducible-research` | Standardize project structure, artifacts, logs, reproducibility |
| `literature-review` | Search, filter, summarize literature |
| `bibliometric-analysis` | Year trends, keywords, journal distribution, clustering |
| `figure-provenance` | Figures must trace to code and data |
| `citation-reviewer` | Check citation format and sources |
| `paper-to-report` | Generate a Markdown report |

### 6.3 Third-party skills

v1 supports installing `K-Dense-AI/scientific-agent-skills` (large set; compatible with
Cursor, Claude Code, Codex, Hermes). Do **not** enable all ~148 skills by default: use
curated install, enable by domain, and show license, dependencies, and risk.

### 6.4 MCP servers

First batch: `filesystem` (project files), `paper-search-mcp` (literature), `BioMCP`
(biomedical databases), `Zotero MCP` (library), `GitHub MCP` (repos/issues/releases),
`local runtime MCP` (execution status). v1 ships filesystem + paper search first;
BioMCP and Zotero follow.

## 7. Execution layer

```text
Execution Layer
├── Hermes local backend
├── Hermes Docker backend
├── Hermes SSH backend
├── Hermes Modal backend
└── Jupyter Kernel Gateway backend
```

Hermes already supports local, Docker, SSH, Modal, Daytona, and Singularity backends.

**v1 default:** local backend + manual approval; Docker optional. Do not hard-depend on
Docker Desktop in v1 — it raises the install barrier significantly.

**v0.3 Jupyter Kernel Gateway** for a more notebook-like experience:

```text
Desktop App → Local Runtime Manager → Jupyter Kernel Gateway → Python / R kernel
→ stream output / figures / tables
```

Jupyter Kernel Gateway is a headless Jupyter kernel server addressable over REST /
WebSocket.

## 8. Local Runtime Manager

### 8.1 Why

The installer should not bundle every scientific dependency (huge installer, slow
updates, cross-platform pain, dependency conflicts, hard debugging). Instead: a
lightweight installer + a first-launch Runtime Manager + on-demand scientific env.

### 8.2 Responsibilities

Detect Hermes; detect Python / uv / Node / Git; create the workspace; create isolated
environments; install base Python packages; manage scientific tool dependencies; start
the Hermes Gateway; start an optional Jupyter Gateway; monitor runtime health.

### 8.3 Runtime directory

```text
~/.ai4s-workbench/
  config/  runtime/{hermes,python,node}/  profiles/ai4s-workbench/
  workspaces/  logs/  cache/  secrets/
```

Windows: `%APPDATA%/AI4S Workbench/` · macOS: `~/Library/Application Support/AI4S Workbench/`

## 9. Storage

### 9.1 Project structure

```text
workspace/
  project.json  plan.md
  data/{raw,processed}/  papers/  parsed/  scripts/  notebooks/
  figures/  reports/  artifacts/  reviews/
  provenance.jsonl  manifest.json
```

### 9.2 SQLite

Stores: project list, session index, artifact index, literature metadata index,
tool-call state, user settings, runtime state.

### 9.3 JSONL

`provenance.jsonl` is an append-only execution record — easy to read, diff, recover,
export, and open-source friendly.

## 10. Artifact provenance

### 10.1 Manifest

```json
{
  "project_id": "bci-trends",
  "created_at": "",
  "artifacts": [
    {
      "id": "fig_year_trend",
      "type": "figure",
      "path": "figures/year_trend.png",
      "created_by_step": "step_004",
      "input_files": ["data/processed/corpus.csv"],
      "code_files": ["scripts/analyze.py"],
      "status": "reviewed"
    }
  ]
}
```

### 10.2 Provenance event

```json
{
  "event_id": "evt_001",
  "step_id": "step_004",
  "type": "code_execution",
  "tool": "python",
  "command": "python scripts/analyze.py",
  "input_files": ["data/processed/corpus.csv"],
  "output_files": ["figures/year_trend.png"],
  "started_at": "",
  "finished_at": "",
  "status": "success"
}
```

### 10.3 Reviewer rules (v1, deterministic)

Artifact exists; output is recorded in provenance; figure has a code file; table has
source data; report includes limitations; citation has a recognizable ID; script can
be re-run.

## 11. Security

### 11.1 Default permissions

The agent may only access the current workspace; command execution requires approval;
it cannot delete files outside the workspace; it cannot read the whole Home directory;
it cannot auto-upload files; it cannot silently install dependencies.

### 11.2 Approval levels

| Action | Default |
| --- | --- |
| Read current project files | Allow |
| Write current project files | Allow (shown) |
| Overwrite file | Ask |
| Delete file | Require approval |
| Shell command | Require approval |
| Install dependency | Require approval |
| Network access | First-time approval |
| Connect remote server | Require approval |
| Access files outside workspace | Require approval |

Hermes supports manual / smart / off approval modes; manual is the default. The desktop
must never default to `off`.

### 11.3 API keys

Stored in macOS Keychain / Windows Credential Manager (fallback: encrypted local
secrets). Never enter provenance, logs, crash reports, git, or exported projects.

## 12. Packaging & release

### 12.1 macOS

Outputs: `AI4S-Workbench-aarch64.dmg`, `AI4S-Workbench-x64.dmg`,
`AI4S-Workbench-universal.dmg` (later). Code signing / notarization needs an Apple
Developer account; a free account cannot notarize, so users may still see an
"unverified" prompt.

### 12.2 Windows

Outputs: `AI4S-Workbench-Setup.exe`, `AI4S-Workbench.msi` (later). Prefer the NSIS
`Setup.exe` in v1 for a familiar install experience. Unsigned apps run but may trigger
SmartScreen; formal release needs a code-signing certificate (EV certs earn SmartScreen
reputation faster). Early GitHub Release preview builds may be unsigned, but the README
must say so.

### 12.3 Auto update

Tauri updater with GitHub Releases + `latest.json` + a Tauri updater signature (update
packages must be signed; signature verification cannot be disabled). v0.1 no forced
auto-update; v0.2 adds a GitHub Releases updater; v0.3 adds in-app update prompts.

### 12.4 CI/CD

GitHub Actions build matrix:

```yaml
macos-latest:
  - aarch64-apple-darwin
  - x86_64-apple-darwin
windows-latest:
  - x86_64-pc-windows-msvc
```

The official Tauri GitHub Action builds native binaries for macOS / Linux / Windows and
uploads to a GitHub Release.

## 13. Process model

### 13.1 Startup

```text
User opens app → Tauri starts → Frontend loads → Runtime Manager checks dependencies
→ Start Hermes Gateway sidecar → Connect to Gateway → Load projects → Ready
```

### 13.2 Agent task

```text
User submits task → Frontend sends prompt to Hermes Gateway → Hermes creates plan
→ Frontend renders plan approval card → User approves → Hermes executes tools
→ Tool events stream back → Runtime writes artifacts → Provenance service records events
→ Reviewer runs checks → Frontend updates artifact/review panels
```

## 14. High-performance design

### 14.1 UI

Layered state: UI state in Zustand, server/runtime state in TanStack Query, streaming
events in an event bus. Big-data optimizations: paginated CSV preview, virtualized log
viewer, lazy Markdown render, lazy artifact load. Render optimizations: memoized
tool-call cards, batched message chunks, `requestAnimationFrame` batching, background
task workers.

### 14.2 Runtime

Persistent Hermes Gateway; reused project sessions; incremental file index; artifact
hash cache; per-project reused Python env; literature metadata cache; cached PDF parse
results; figure preview thumbnails.

### 14.3 Startup targets

```text
App UI cold start: < 3s
Runtime ready: < 10s
First agent response: < 5s after runtime ready
```

Strategy: UI first, runtime after; show runtime-loading state on Home; a failed Hermes
connection must not block the UI; first-time dependency install happens in onboarding.

## 15. Error handling

### 15.1 Runtime errors

Hermes not installed; Gateway start failure; port in use; missing API key; model
connection failure; workspace permission denied; broken Python env; Docker unavailable;
MCP server start failure. Each must provide: a human-readable explanation, collapsible
technical details, a one-click fix button, and a copy-logs button.

### 15.2 Agent errors

Tool-call failure; literature source rate-limited; dependency install failure; code run
failure; file permission failure; citation check failure. Must show: the failed step,
the cause, a fallback suggestion, a retry button, and an edit-plan button.

## 16. Repository structure

Monorepo:

```text
ai4s-workbench/
  apps/desktop/{src,src-tauri}/
  packages/{ui,shared,sdk}/
  runtime/{manager,hermes-profile,mcp,skills}/
  docs/{PRD.md,TECHNICAL_DESIGN.md}
  examples/bci-trends/
  scripts/{release,dev}/
```

- `apps/desktop` — Tauri + React desktop app.
- `runtime/manager` — local runtime manager (detect deps, start sidecar, manage ports
  and workspace, write provenance, collect logs).
- `runtime/hermes-profile` — the AI4S Workbench Hermes profile.
- `runtime/skills` — self-authored scientific skills.
- `examples` — the complete demo project.

## 17. v0.1 task breakdown

### 17.1 Day-one goals

1. Init Tauri + React.
2. Build the main layout.
3. Build a static onboarding page.
4. Build a static project workspace page.
5. Build tool-call card / artifact card / approval dialog.
6. Connect the Hermes Gateway (or mock the event stream first).
7. Write the Hermes profile.
8. Write the 3 core skills.
9. Build static artifacts for the BCI demo.
10. Draft the GitHub Actions build.

### 17.2 v0.1 must deliver

macOS app runs; Windows app runs; README has screenshots; a complete demo; API key
config; open a workspace; communicate with Hermes (or at least a mock + documented
integration path); show plan / tool / artifact / review; export `report.md`.

## 18. Technical risks

### 18.1 Hermes desktop integration

Risk: Hermes API / Gateway interface changes. Mitigation: wrap a `HermesClient`; never
call Hermes directly from the UI; support the API Server fallback; pin the Hermes
version; maintain the profile distribution independently.

### 18.2 Windows environment complexity

Risk: WebView2, permissions, Defender, SmartScreen, PATH, missing Python / Git / Node.
Mitigation: the Runtime Manager detects the environment; do not hard-depend on system
Python early; provide a portable fallback; code-sign for formal releases.

### 18.3 Installer size

Risk: bundling Python, Node, Hermes, and scientific packages makes the installer huge.
Mitigation: keep the app body light; install runtime on demand; install science
dependencies per profile; defer Docker / Jupyter.

### 18.4 Agent safety

Risk: the agent runs commands, reads/writes files, accesses the network. Mitigation:
manual approval by default; workspace allowlist; isolated local secrets; dangerous-
command dialogs; recommend the Docker backend; full provenance recording.

## 19. Final recommended stack

```text
Tauri 2
React + TypeScript + Vite
Tailwind + Radix UI
Hermes Agent as runtime
Hermes TUI Gateway JSON-RPC
AI4S Hermes Profile Distribution
K-Dense scientific-agent-skills curated integration
Local workspace + SQLite + JSONL provenance
NSIS / DMG installer
GitHub Releases
```

One line:

**Use Tauri for a high-performance modern desktop shell, Hermes as the Claude Code
alternative layer, scientific skills and MCP as the research capability layer, and
provenance/reviewer as the real moat of an open-source Claude Science alternative.**
