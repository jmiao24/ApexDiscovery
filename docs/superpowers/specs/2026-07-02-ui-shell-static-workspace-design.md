# Slice #1 — UI Shell + Static Workspace (Design Spec)

Date: 2026-07-02
Status: Awaiting user review
Part of: AI4S Workbench Desktop v0.1 (see `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`)

## 1. Why this slice first

v0.1 is ~8 independent subsystems. This slice is the frontend foundation every later
slice plugs into. It is independently verifiable (launch it, click through every page)
and produces the README screenshots. It has **no** dependency on Hermes, Python, Rust,
or the network, so it can be built and shipped immediately with the available tooling
(Node 24 / pnpm 9.4).

Build order for the rest of v0.1 (each its own spec → plan → implement cycle):
2. HermesClient SDK + live agent chat · 3. Runtime Manager · 4. Provenance + Reviewer ·
5. Literature search · 6. Artifacts/export · 7. Packaging/CI · 8. BCI demo content.

## 2. Goal & non-goals

**Goal:** a runnable frontend that renders the entire workbench UI with mock data, in
both light and dark themes, navigable across all pages, with the key interaction cards
(plan / tool-call / approval / artifact) rendered from realistic fixtures.

**Non-goals (this slice):** no real agent, no real data or persistence, no network
calls, no code execution, no Tauri native shell yet.

## 3. Decisions adopted

- **First slice = UI shell + static workspace** (recommended; user was away, defaults adopted).
- **Browser-first**: build as a pure Vite React app runnable via `pnpm dev` in a browser.
  The thin Tauri `src-tauri` wrapper is added in a later step once Rust (rustup) is
  installed. Reversible — the frontend code does not change when wrapped.
- **Component style**: shadcn-style — copy-in components built on Radix primitives +
  Tailwind, for full control over the restrained/refined aesthetic (PRD §6.1). No heavy
  prebuilt component library.

## 4. Tech stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | React + TypeScript + Vite | Per tech design §4.1 |
| Styling | Tailwind CSS + Radix UI (shadcn-style) | Copy-in components |
| Routing | React Router | |
| UI state | Zustand | theme, active project, panel toggles, palette open |
| Command palette | `cmdk` | ⌘K / Ctrl+K |
| Markdown | `react-markdown` (+ remark-gfm) | reports, plan, review |
| Code view | `highlight.js` (lightweight, synchronous, read-only) | Monaco deferred |
| Testing | Vitest + React Testing Library | TDD |

**Deferred by YAGNI:** Monaco editor, charting library (ECharts/Plotly — figures shown
as static images this slice), TanStack Query (no real async yet), `packages/ui`
extraction (components live in `apps/desktop` until a second consumer exists), real
Tauri shell, persistence.

## 5. Monorepo layout

Activate pnpm workspaces now:

- `pnpm-workspace.yaml` + root `package.json` (workspace scripts, shared devDeps).
- **`apps/desktop`** — the Vite React app (active).
- **`packages/shared`** — the stable domain TypeScript types, imported by the app and,
  later, by the SDK/runtime: `Project`, `Plan`, `PlanStep`, `ToolCall`, `ToolCallStatus`,
  `Artifact`, `ArtifactType`, `ProvenanceEvent`, `Citation`, `ReviewFinding`,
  `RuntimeStatus`, `ModelStatus`. (active)
- `packages/ui`, `packages/sdk` — remain stubs until a second consumer exists.

## 6. Application structure

Reuses the existing `apps/desktop/src` skeleton (tech design §4.2):

```text
src/
  app/
    routes/        # route definitions + page components
    layout/        # AppShell, TopBar, Sidebar, ArtifactDock
    providers/     # ThemeProvider, RouterProvider, StoreProvider
  components/
    sidebar/ topbar/ command-palette/ cards/ artifact-viewer/
    approval-dialog/ tool-call-card/ code-viewer/ markdown-viewer/
  features/
    onboarding/ projects/ chat/ agent-runtime/ literature/
    artifacts/ provenance/ review/ skills/ settings/
  lib/
    store/         # Zustand stores
    theme/         # CSS variables, tokens, theme toggle
    mock/          # fixtures (the BCI-trends demo project)
    events/ api/   # stubs this slice; wired in slice #2
```

### 6.1 Layout

`AppShell` composes:

- **TopBar** — project selector · model status pill · runtime status pill · sync · settings.
- **Sidebar** (left) — global nav: Projects, Workflows, Skills, Connectors, Settings.
- **Main** — `<Outlet/>` for the active route.
- **ArtifactDock** (right) — Files / Figures / Tables / Citations / Review; shown on
  project routes, collapsible.

### 6.2 Routes

| Path | Page | Content |
| --- | --- | --- |
| `/` | Home | welcome card, new project, recent projects, example workflows, runtime status, model status |
| `/project/:id` | Workspace | 3-column: file/workflow tree ‖ agent chat + plan card + tool-call cards + execution timeline ‖ artifact dock |
| `/project/:id/literature` | Literature | search box, filters, list, abstract preview, add-to-corpus, export buttons |
| `/project/:id/data` | Data & Code | file tree, script preview (highlighter), CSV preview, run history |
| `/project/:id/artifacts` | Artifacts | figure gallery, report preview, table preview, provenance chain |
| `/project/:id/review` | Review | citation / figure-provenance / data-source / reproducibility checks, warnings, limitations |
| `/skills` | Skills | installed, recommended, install-from-GitHub, enable/disable, SKILL.md view |
| `/settings` | Settings | model provider, API keys (masked), workspace path, runtime backend, approvals, theme |
| `*` | NotFound | 404 |

### 6.3 Key components (with props from `packages/shared` types)

- **PlanCard** — goal, steps, tools, expected artifacts, risks, auth-required actions;
  buttons: Approve & Run · Edit Plan · Run Step-by-step · Save as Workflow (stubbed → toast).
- **ToolCallCard** — name, status badge, input/output summary, duration, view-details,
  copy-log. Status ∈ {Pending, Running, WaitingApproval, Success, Warning, Failed}.
- **ApprovalDialog** — action description; options Allow Once · Always Allow for Project ·
  Deny · View Details (Radix Dialog).
- **CommandPalette** — ⌘K/Ctrl+K; actions: new project, search literature, run reviewer,
  open settings, switch model, install skill, export report (navigate or toast).
- **ArtifactViewer / MarkdownViewer / CodeViewer** — render fixtures.

## 7. Theming

CSS custom properties for the PRD §6.2 palette (light + dark). Light: warm-white bg,
deep-indigo primary, teal accent, soft green/amber/red for success/warning/error. Dark:
near-black/deep-navy bg, dark-slate cards, blue-violet primary, cyan accent. Toggle in
TopBar/Settings, persisted to `localStorage` via Zustand; respects `prefers-color-scheme`
on first load.

## 8. Mock data

A single fully-populated **BCI-trends** fixture project under `src/lib/mock/`, matching
the demo in PRD §8: a plan, ~40 corpus rows, three placeholder figures (static PNG/SVG),
`report.md`, `review.md`, and a sequence of provenance events + a manifest. Typed against
`packages/shared`. Doubles as the demo content and screenshot source.

## 9. State & data flow

- **Zustand** stores: `uiStore` (theme, sidebar/dock collapse, palette open), `projectStore`
  (active project id, selected artifact). Mock data is imported synchronously from
  `lib/mock`; no async layer this slice.
- `lib/events` and `lib/api` are typed stubs (empty interfaces) so slice #2 can implement
  them without restructuring.

## 10. Error & empty states

Static UI, so minimal but designed-in: 404 route page; empty-state components for empty
lists (no projects, no artifacts); disconnected states for the runtime/model status pills
(foreshadowing real states); loading skeleton components exist even if mock data is
synchronous, so slice #2 can reuse them.

## 11. Testing (TDD)

Vitest + React Testing Library. Write tests first per superpowers TDD:

- Each route renders its page with mock data without throwing.
- `ToolCallCard` renders the correct badge for each status.
- `PlanCard` renders all sections and buttons.
- Theme toggle flips the `data-theme` attribute and persists.
- CommandPalette opens on the shortcut and filters actions by query.

## 12. Success criteria (verification)

1. `pnpm install && pnpm --filter desktop dev` serves the app in a browser.
2. Every route renders with mock data in **both** light and dark themes.
3. ⌘K/Ctrl+K opens the command palette and filtering works.
4. Zero console errors/warnings on navigation.
5. `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.
6. The Workspace page is screenshot-ready for the README.

## 13. Explicitly out of scope / deferred

Real Tauri shell (`src-tauri`), Monaco, charting library, TanStack Query, `packages/ui`
and `packages/sdk` implementation, real agent/runtime, persistence, literature APIs,
provenance writing, packaging/CI. Each is a later slice.
