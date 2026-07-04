# Open Science — Prioritized Requirements (Community-Informed)

> **Purpose.** This document turns real community feedback on **Claude Science**
> (Hacker News, Reddit r/comp_chem & r/singularity, LinkedIn) into concrete,
> prioritized requirements for **Open Science**, our open-source alternative.
> It complements `PRD.md` (the full product spec): the PRD says *what the product
> is*; this file says *what to build first and why*, tied to evidence.
>
> Reading order: priority tiers (P0 → P2), each requirement with **Evidence**
> (what users actually said), **Requirement**, and **Acceptance** (a checkable
> result). Status reflects `PROGRESS.md` as of 2026-07-03.

## 0. Positioning takeaway

The real moat of Claude Science is **not the model**. It is the combination of:

1. a **research agent runtime** (run tools/pipelines, not just chat),
2. a **reproducible artifact system** (every figure/table/notebook traces to
   code, environment, inputs, and conversation), and
3. **domain tool/database connectors**.

Open Science must win on the same three axes — plus two things Claude Science is
criticized for lacking: **multi-discipline breadth** and **Windows support**.

Do **not** market as "open-source Claude Science" or "zero hallucination."
Market as: *"Open Science — an open AI research workbench for reproducible
science."* Sell **traceable / verifiable**, not **perfect**.

---

## P0 — Must-have (the actual moat; core differentiation)

These are what positive community feedback consistently valued. Without them we
are "just Jupyter + a chatbot" — the exact criticism leveled at competitors.

### P0-1 · Run a full workflow end to end, not a chat box

- **Evidence.** LinkedIn and HN praise centered on *"it did the whole analysis"*
  — download data → run pipeline → produce figures → draft manuscript → save a
  traceable record. One user automated a workflow that first took ~1 month.
- **Requirement.** The agent must chain: fetch data → run code/pipeline →
  generate figures/tables → write results → persist a reproducible record, in one
  workspace, with visible plan/approval steps.
- **Acceptance.** From a single natural-language request, produce at least one
  figure **and** one report artifact, each linked to the code that made them,
  without the user leaving the app.
- **Status.** Shipped: the empty session offers one-click workflow starters
  (demo end-to-end analysis, analyze-my-data, audit-a-report, and the
  climate-trends example on real bundled data); the demo starter verifiably
  produces code → figure → report → stats in one turn, all files surfaced as
  artifacts with provenance records. Gap: bci-trends is still repo-only.

### P0-2 · Local data + local compute (restricted-environment friendly)

- **Evidence.** Heavy interest in whether data leaves the machine (WGS, CRAM,
  lab-internal data, HPC). An HN user ran whole-genome analysis with large CRAM
  files processed **locally**. Pharma/genomics data is often locked in TREs; a
  local server + browser UI is seen as the way into that world.
- **Requirement.** Python/R/shell execution on the local machine by default; raw
  data and computation stay on the user's infrastructure; no silent upload.
- **Acceptance.** A user can complete an analysis with zero data leaving the
  device; the app can state plainly what (if anything) is sent to a model
  provider. Persistent kernels keep variables/dataframes/models in memory to
  avoid reloads.
- **Status.** Shipped for local Python **and R** kernels + Jupyter sidecar
  (isolated env, workspace-scoped). Each notebook runs one persistent local
  kernel keyed by its kernelspec language; R uses a base-R-only bridge (no
  IRkernel/jsonlite needed), so R notebooks run cell-by-cell with shared state,
  last-expression values, stdout/warnings, and error reporting — against any
  installed R, offline. New-notebook menu offers Python or R. Settings carries a
  plain-language "Privacy & data flow" card stating what stays local vs. what the
  model provider sees.

### P0-3 · Provenance / reproducibility for every artifact

- **Evidence.** Called out repeatedly as the key research pain point and the true
  differentiator over generic Claude/ChatGPT. One user's example: a paper had
  figure A/B swapped vs. its caption — if the pipeline were reproducible, such
  errors become visible bugs, not post-hoc third-party catches.
- **Requirement.** Every figure/table/notebook/report binds to: the code that
  generated it, the environment, input files, the agent conversation, and run
  logs. Records are stable and versioned (`provenance.jsonl`).
- **Acceptance.** For any artifact, one click reveals its generating code +
  environment + inputs + originating conversation turn; re-running reproduces it.
- **Status.** Shipped: every agent write appends a version record to
  `.openscience/provenance.jsonl` (code, tool, model, session, timestamp, and
  the captured environment — Python version, OS/arch, app build); the artifact
  History panel reveals per-version data + a link back to the originating
  conversation, and a per-version **Reproduce** action drafts a prompt (never
  auto-sent) that re-runs the recorded code and reports whether the regenerated
  file matches. Package-level capture is shipped too: each record captures
  `pip freeze` (once per app run) into a content-addressed lockfile
  `.openscience/env/<hash>.txt` (identical environments dedupe to one file);
  the record carries only `{count, hash}`, the History panel shows an "N
  packages" chip that reveals the full list on click, and the Reproduce prompt
  points the agent at the lockfile to reinstall matching versions.

### P0-4 · Reviewer agent — traceable claims, not "no hallucinations"

- **Evidence.** Community distrusts "zero hallucination" claims (estimates of
  5–15% residual citation error survive even with Crossref/Semantic
  Scholar/PubMed/arXiv checks; the most dangerous case is "looks good enough but
  still wrong"). But they *do* buy **verifiable**: users restrict autonomous
  tasks to checkable questions and review manually.
- **Requirement.** A reviewer that performs **citation audit**, **untraceable-
  number flagging**, and **figure ↔ code consistency checks** — surfaced as
  structured, dismissible findings, never as a guarantee of correctness.
- **Acceptance.** The reviewer flags at least: (a) a citation it cannot resolve,
  (b) a number in the report with no traceable source, (c) a figure whose
  underlying code changed. Copy never promises "no errors."
- **Status.** Shipped: the bundled first-party `traceability-review` skill runs
  all three checks (Crossref/arXiv/PubMed citation resolution, unsourced-number
  flagging, figure↔code staleness via `provenance.jsonl`) and emits the
  structured review contract; reviewer cards tag each finding with its check
  type and are dismissible one by one. Gap: hardening across document formats
  (PDF manuscripts) and models weaker at tool use.

---

## P1 — Strong differentiators (win vs. the criticism)

### P1-1 · Multi-discipline from day one (don't be "life-sciences only")

- **Evidence.** A top criticism: Claude Science feels too biology-centric — one
  user found **zero** non-bio connectors and asked for astrophysics-type
  examples. Its preset domains cluster in genomics/single-cell/proteomics/
  structural-biology/cheminformatics.
- **Requirement.** Architect for a **multi-discipline plugin marketplace** (MCP/
  Skills), but ship an MVP with only **1–2 strong scenarios** done well. Make the
  extensibility visible so non-bio users see a path in.
- **Acceptance.** At least one non-bio example project ships (e.g. a materials,
  geoscience-sensor, or general data-analysis workflow) alongside the bio demo;
  adding a connector for a new field requires no core code change.
- **Status.** Skills + MCP management shipped and pluggable. Non-bio showcase
  shipped: `examples/climate-trends/` (real NASA GISTEMP v4 data, public
  domain, bundled in the installer) with a one-click "Explore an example"
  starter that installs the files into the workspace (never overwriting user
  edits) and runs the full trend/decadal/figure/report workflow.

### P1-2 · Domain connectors (databases + literature)

- **Evidence.** 60+ database + BioNeMo + ClinVar/PubMed/arXiv/FDA connectivity is
  seen as a genuine highlight — but perceived as "strong for life sciences, weak
  elsewhere."
- **Requirement.** MCP connectors for PubMed, arXiv, Semantic Scholar, Crossref,
  and (bio) PDB/UniProt/ChEMBL/ClinVar; plus a documented pattern for users to
  wire their own lab tools / ELN / internal systems.
- **Acceptance.** A user can, from chat, query at least PubMed + arXiv +
  Crossref and get results the reviewer can later audit; a "bring your own MCP"
  path is documented and works.
- **Status.** Shipped: Settings lists curated open-source science MCP connectors
  (literature: arXiv/PubMed/Crossref/Semantic Scholar via paper-search-mcp; bio:
  PubMed/trials/variants via biomcp) with one-click Enable that provisions them
  into an isolated env via the bundled uv and registers them; plus
  `docs/CONNECT_YOUR_TOOLS.md` for bring-your-own MCP/skills. We integrate
  existing open-source servers, not reimplement them. Gap: broader curated set.

### P1-3 · Scientific renderers (native viewers)

- **Evidence.** Community explicitly "likes the visualization." r/comp_chem wants
  it, and some want stronger 3D/education-grade views over time.
- **Requirement.** Native, in-app renderers. Prioritize 2–3 first: PDF, tables,
  matplotlib/plotly figures; then protein structure, chemical structure, genome
  tracks. Figures must be **publication-grade by default** (see P1-5), not raw
  library output.
- **Acceptance.** PDF, tables, and matplotlib/plotly render natively without
  export; at least one domain renderer (protein *or* chemical structure) ships.
- **Status.** Shipped. File previews (pdf/html/docx/xlsx/pptx) + figure
  artifacts, plus TWO native domain renderers: an interactive 3D structure
  viewer (3Dmol.js: cif/pdb/mol/mol2/sdf/xyz/pqr/cube + SMILES) and a native
  genome-track viewer (BED/bedGraph/GFF3/GTF/VCF) — features on a base-pair
  axis with drag-to-pan / scroll-to-zoom, row-packed so overlaps stay visible,
  a contig selector, and colors from the app's series palette (theme-aware),
  all offline from the file alone (no reference genome, no service).

### P1-5 · Interaction & visualization craft (the app must feel premium)

- **Evidence.** Community "likes the visualization" and repeatedly frames the
  product's value as *the experience* of doing the whole workflow in one place —
  not the model. The recurring criticism ("old wine, new bottle," "Jupyter with
  Claude built-in") is really a criticism of **undifferentiated UX**. Polish is
  what separates a workbench from a wrapper.
- **Requirement.** Two parts:
  1. **Beautiful charts by default.** Every generated figure — whether from
     agent code (matplotlib/plotly) or native app UI (dashboards, stat tiles,
     provenance graphs) — follows one coherent design system: a consistent,
     accessible categorical/sequential palette that works in **both light and
     dark** themes; readable axes/legends/tooltips; no default library chrome;
     wide content (tables, tracks) scrolls in its own container instead of
     breaking the layout. Charts should read as one system, not one-off outputs.
  2. **High-quality interactions.** Streaming agent output; live tool-call
     refresh; smooth artifact open/version-switch; keyboard-first (command
     palette); clear plan/approval affordances; no jank, no layout shift,
     virtualized long lists, lazy-loaded figures. First-run and file-open paths
     feel instant and reliable.
- **Acceptance.** (a) A generated figure and a native dashboard tile share the
  same palette and render correctly in light and dark mode. (b) Core flows
  (open artifact, switch version, run cell, approve plan) have no visible jank on
  a mid-range laptop. (c) The command palette reaches every primary action.
- **Status.** Shipped: one documented chart design system — a validated
  categorical/sequential/status palette that is the single source of truth in
  three places kept in sync (`@ai4s/shared` chartPalette, `index.css --series-*`,
  and `runtime/.../openscience.mplstyle` applied by the `publication-figures`
  skill), so an agent-generated matplotlib figure and native app UI read as one
  system in both light and dark (validated with the dataviz standard against the
  app's real surfaces). Command palette reaches every primary action (all real:
  new session, two workflows, notebooks, skills, settings, theme). Empty session
  redesigned into a calm, centered welcome. Gap: a native categorical chart
  surface when a real dataset needs one; broader interaction polish.

### P1-4 · Cross-platform installer incl. Windows

- **Evidence.** Claude Science's official entry lists only Mac and Linux; HN
  noted Linux download/usability friction. Shipping Windows/macOS/Linux makes us
  feel more like a consumer-grade product.
- **Requirement.** One-click installers for macOS **and** Windows (Linux next);
  first-launch works without CLI knowledge.
- **Acceptance.** A non-technical user installs and reaches a working first
  session on both macOS and Windows via a signed installer.
- **Status.** macOS installer shipped; Jupyter/uv sidecars bundled. Windows
  build pipeline in place (CI `build.yml` matrix produces NSIS `.exe` / `.msi`;
  both sidecar fetch scripts emit the `*-x86_64-pc-windows-msvc.exe` binaries)
  and the cross-platform code paths audited — fixed a Windows-only orphaned-
  jupyter cleanup gap (was Unix-only, would wedge the fixed port). Gap (host-
  bound): producing + code-signing the installer and verifying a real Windows
  first-run require a Windows machine/CI — cannot be done on the macOS dev host.

---

## P2 — Important, later (address remaining pain and objections)

### P2-1 · Notebook interactivity **and** larger-project handling

- **Evidence.** Users want Jupyter-style interactivity *and* IDE-grade handling
  of bigger code projects. A recurring complaint about Claude Code + VS Code
  Jupyter: notebooks often need a full from-scratch rerun.
- **Requirement.** Keep the conversation-first runnable-notebook UX, but avoid
  the "rerun the whole notebook" trap (persistent kernel, per-cell reruns,
  agent edits picked up via reload); provide a path for multi-file projects.
- **Acceptance.** Editing/agent-editing one cell does not force a full rerun;
  variables persist across cells and turns.
- **Status.** Persistent kernel + per-cell run + reload + session↔notebook chips
  shipped. Multi-file handling shipped: a native workspace **Files** explorer
  (sidebar) browses the whole project tree — folders navigable via a breadcrumb,
  type-aware icons + sizes — and opens ANY file in the native viewers (figures,
  tables, PDF, molecule/genome renderers, runnable notebooks), not just the
  files the agent happened to mention.

### P2-2 · HPC / SSH / Slurm / Modal compute management

- **Evidence.** Interest in HPC login nodes and Slurm batch submission; the
  local-server + browser-UI shape is seen as the way into restricted clusters.
- **Requirement.** Manage environments across laptop, Linux box, HPC login node;
  write/submit/manage Slurm batch scripts over SSH; optional Modal runner.
- **Acceptance.** From the app, generate a Slurm batch script, submit over SSH,
  and track job status.
- **Status.** Shipped for the SSH + Slurm core: Settings has a "Cluster (HPC)"
  card (pick a host from `~/.ssh/config` or type `user@host`, probe SSH + Slurm,
  live job queue with cancel — all via the user's own ssh keys, nothing
  installed on the cluster); the bundled `hpc-slurm` skill lets the agent write
  a batch script into the workspace (provenance-tracked), submit it over SSH,
  track it via squeue/sacct, and fetch results back. Gap: multi-environment
  management and the Modal runner.

### P2-3 · Privacy posture, stated plainly

- **Evidence.** Users asked whether handing whole-genome data to a commercial
  company is safe; competitor FAQ keeps raw data local but retains prompts/model
  responses under standard policy.
- **Requirement.** A clear, in-product statement of what stays local vs. what a
  model provider sees; keys in OS keychain; nothing sensitive in provenance/logs/
  exports (already a non-negotiable safety default).
- **Acceptance.** A user can read, in the app, exactly what leaves the machine
  for their chosen provider; audit confirms keys/data never enter provenance,
  logs, or exports.
- **Status.** Shipped. Workspace sandbox + approval mode + the plain-language
  data-flow disclosure card in Settings. Provider credentials now live at rest in
  the **OS keychain** (macOS Keychain / Windows Credential Manager via the
  `keyring` crate): the app hydrates OpenCode's `auth.json` from the keychain
  before the sidecar starts and, on exit, writes it back and deletes the
  plaintext file — so no credential file sits on disk between runs. Invariant:
  credentials are never lost (the file is removed only after a successful
  keychain write; any failure keeps it). Verified end to end (auth.json →
  keychain on quit → byte-identical restore on next launch → OpenCode ready with
  the configured model).

### P2-4 · Beta stability & guardrails

- **Evidence.** Early competitor reports: "can't open project files," crashes on
  first try, Linux download button issues. Also a fear of "AI review noise" /
  paper slop leaking into peer review.
- **Requirement.** Robust first-run and file-open paths; restrict autonomous
  behavior to verifiable tasks with human-in-the-loop; do not push
  auto-generated review noise outward.
- **Acceptance.** Open/close/reopen a project reliably; the agent asks for
  approval on destructive/outward-facing actions; reviewer output stays in-app.
- **Status.** Approval mode + sandbox shipped; the agent's interactive requests
  (the `question` pick-an-option tool and permission prompts) now render as an
  answerable card and reply through OpenCode's directory-scoped question/
  permission API — previously they hung the session with no way to respond.
  Also fixed a real exit-cleanup bug: on macOS Cmd+Q/Quit the app terminates via
  `RunEvent::Exit` (not `ExitRequested`), so the OpenCode sidecar (and the
  kernel / Jupyter) used to orphan on every quit; cleanup now runs on both
  events, so quitting reliably reaps the child processes. Gap: dedicated
  first-run/file-open reliability pass.

---

## Priority summary

| # | Requirement | Tier | Status |
|---|---|---|---|
| P0-1 | Full workflow end to end (not chat) | P0 | One-click starters + bundled real-data example shipped |
| P0-2 | Local data + local compute | P0 | Done: local Python **and R** kernels + data-flow card |
| P0-3 | Artifact provenance / reproducibility | P0 | Versioned records + env & package-lockfile capture + History UI + Reproduce shipped |
| P0-4 | Reviewer: traceable claims (3 checks) | P0 | Skill + tagged/dismissible findings shipped |
| P1-1 | Multi-discipline from day one | P1 | Pluggable + non-bio climate example shipped |
| P1-2 | Domain + literature connectors | P1 | Curated one-click connectors + BYO guide shipped |
| P1-3 | Scientific renderers | P1 | Base previews + 3D structure viewer + genome-track viewer shipped |
| P1-4 | Windows + macOS installers | P1 | macOS done; Windows CI pipeline + code paths ready (signing/real-Windows verify is host-bound) |
| P1-5 | Interaction & visualization craft | P1 | Chart design system + palette + command palette shipped |
| P2-1 | Notebook + larger-project handling | P2 | Notebook + workspace Files explorer (browse tree, open any file) shipped |
| P2-2 | HPC / SSH / Slurm / Modal | P2 | SSH+Slurm shipped (cluster card + skill); Modal pending |
| P2-3 | Plain-language privacy posture | P2 | Disclosure + OS-keychain credential storage shipped |
| P2-4 | Beta stability & guardrails | P2 | Interactive prompts + exit-cleanup (no orphaned sidecar) fixed; first-run pass pending |

## What to say (and not say)

- **Say:** reproducible, traceable, verifiable, local-first, multi-discipline,
  model-agnostic, cross-platform (incl. Windows), beautiful & polished.
- **Don't say:** "open-source Claude Science," "zero hallucination," "replaces
  your specialized tools." We aggregate tools into one workbench; we don't
  replace them.
