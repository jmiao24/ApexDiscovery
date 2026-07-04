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
  (demo end-to-end analysis, analyze-my-data, audit-a-report); the demo starter
  verifiably produces code → figure → report → stats in one turn, all files
  surfaced as artifacts with provenance records. Gap: richer built-in example
  projects (bci-trends is repo-only).

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
- **Status.** Shipped for local Python kernel + Jupyter sidecar (isolated env,
  workspace-scoped); Settings now carries a plain-language "Privacy & data
  flow" card stating what stays local vs. what the model provider sees. Gap: R
  kernel.

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
  `.openscience/provenance.jsonl` (code, tool, model, session, timestamp); the
  artifact History panel reveals per-version data + a link back to the
  originating conversation. Gap: environment capture beyond the model (packages,
  kernel), and re-run-to-reproduce.

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
- **Status.** Skills + MCP management shipped and pluggable. Gap: a non-bio
  showcase example (current demo is `examples/bci-trends/`).

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
- **Status.** File previews (pdf/html/docx/xlsx/pptx) + figure artifacts exist.
  Gap: domain renderers (structure/track viewers).

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
- **Status.** macOS installer shipped; Jupyter/uv sidecars bundled. Gap: Windows
  installer parity (NSIS `.exe` / `.msi`).

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
  shipped. Gap: multi-file/"IDE for larger projects" ergonomics.

### P2-2 · HPC / SSH / Slurm / Modal compute management

- **Evidence.** Interest in HPC login nodes and Slurm batch submission; the
  local-server + browser-UI shape is seen as the way into restricted clusters.
- **Requirement.** Manage environments across laptop, Linux box, HPC login node;
  write/submit/manage Slurm batch scripts over SSH; optional Modal runner.
- **Acceptance.** From the app, generate a Slurm batch script, submit over SSH,
  and track job status.
- **Status.** Not started (roadmap v0.4).

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
- **Status.** Workspace sandbox + approval mode shipped; the plain-language
  data-flow disclosure card is live in Settings. Gap (correction): provider
  credentials currently live in an app-private `auth.json` (mode 600, managed
  by OpenCode) — NOT the OS keychain; moving them to the keychain remains open.

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
  Gap: dedicated first-run/file-open reliability pass.

---

## Priority summary

| # | Requirement | Tier | Status |
|---|---|---|---|
| P0-1 | Full workflow end to end (not chat) | P0 | One-click starters shipped; example projects pending |
| P0-2 | Local data + local compute | P0 | Done incl. data-flow card (R kernel pending) |
| P0-3 | Artifact provenance / reproducibility | P0 | Versioned records + History UI shipped; re-run pending |
| P0-4 | Reviewer: traceable claims (3 checks) | P0 | Skill + tagged/dismissible findings shipped |
| P1-1 | Multi-discipline from day one | P1 | Pluggable; non-bio demo pending |
| P1-2 | Domain + literature connectors | P1 | Curated one-click connectors + BYO guide shipped |
| P1-3 | Scientific renderers | P1 | Base previews done; domain viewers pending |
| P1-4 | Windows + macOS installers | P1 | macOS done; Windows pending |
| P1-5 | Interaction & visualization craft | P1 | Chart design system + palette + command palette shipped |
| P2-1 | Notebook + larger-project handling | P2 | Notebook done; project ergonomics pending |
| P2-2 | HPC / SSH / Slurm / Modal | P2 | Not started |
| P2-3 | Plain-language privacy posture | P2 | Disclosure shipped; keychain migration open |
| P2-4 | Beta stability & guardrails | P2 | Base done; reliability pass pending |

## What to say (and not say)

- **Say:** reproducible, traceable, verifiable, local-first, multi-discipline,
  model-agnostic, cross-platform (incl. Windows), beautiful & polished.
- **Don't say:** "open-source Claude Science," "zero hallucination," "replaces
  your specialized tools." We aggregate tools into one workbench; we don't
  replace them.
