# Molecules Opportunity Atlas

Molecules Opportunity Atlas is the public-facing data-source map for
**APEX Discovery**. It explains which regulatory, clinical, biological,
structural, literature, and market sources can support molecule-opportunity
research, and provides a direct entry point into the local APEX Discovery app.

This folder contains the deployable React/Vinext site. It is intentionally a
small, mostly static surface: the website describes and links the research
universe; the APEX Discovery application performs the agentic research.

## What this application does

- Presents the APEX Discovery value proposition.
- Organizes supported evidence sources into a linked catalog.
- Sends each data-source card to the source's official website.
- Provides **Try APEX Discovery** links to the configured APEX instance.
- Generates site-specific metadata, social cards, and responsive styling.

It does **not** query the databases itself, store scientific records, or run an
agent in the browser.

## How it fits with APEX Discovery

```text
Visitor
  |
  v
Molecules Opportunity Atlas website
  |-- data-source card --> official external database
  |
  `-- Try APEX Discovery --> http://127.0.0.1:49369
                                 |
                                 `--> APEX agent, skills, tools, and evidence
```

The current destination is defined by `APEX_DISCOVERY_URL` in `app/page.tsx`.
It points to a locally running APEX Discovery server. A hosted Atlas does not
automatically host APEX Discovery; the person clicking the button must have an
APEX server available at the configured address.

## Implementation

The site uses React Server Components through
[Vinext](https://github.com/cloudflare/vinext) and builds to a Cloudflare
Worker-compatible output.

```text
app/page.tsx
  |-- hero and APEX entry point
  `-- dataSources[] --> linked source cards

app/layout.tsx
  |-- title and description
  |-- favicon
  `-- Open Graph / X metadata

app/globals.css
  `-- responsive layout and visual system

Vite + Vinext
  `-- dist/client + dist/server deployment output
```

The page currently links FDA Purple Book, DailyMed, ClinicalTrials.gov, Open
Targets, PubMed, PubMed Central, ChEMBL, UniProt, RCSB PDB, bioRxiv, medRxiv,
arXiv, OpenAlex, WHO ICTRP, and SEC EDGAR.

These cards describe the intended research surface. A card should not be
interpreted as proof that every record from that source has been ingested into
every APEX environment. The runtime's installed skills and tools are the source
of truth for what an agent can query in a particular deployment.

## Project map

- `app/page.tsx` — page content, source catalog, and APEX destination.
- `app/layout.tsx` — metadata, fonts, favicon, and social preview settings.
- `app/globals.css` — responsive styles.
- `public/og.png` — project-specific social preview image.
- `public/favicon.svg` — browser icon.
- `.openai/hosting.json` — OpenAI Sites project metadata.
- `vite.config.ts` — Vinext and local Cloudflare bindings.
- `worker/index.ts` — Cloudflare Worker entry point.
- `tests/rendered-html.test.mjs` — server-rendering and starter-removal checks.
- `db/` and `examples/d1/` — optional starter scaffolding; the current Atlas
  does not use D1 or persist user data.

The repository also contains standalone snapshots at
`/molecules-opportunity-atlas.html` and
`/website/molecules-opportunity-atlas.html`. Those files are separate static
artifacts and are not automatically regenerated when this React application
changes.

## Requirements

- Node.js `>=22.13.0`
- npm

## Run locally

From this folder:

```bash
npm ci
npm run dev
```

Open the local URL printed by Vinext. To make the **Try APEX Discovery** button
work, start APEX Discovery separately on `http://127.0.0.1:49369`, or change
`APEX_DISCOVERY_URL` in `app/page.tsx`.

## Build and verify

```bash
npm run build
npm test
npm run lint
```

- `npm run build` creates the worker-compatible production bundle.
- `npm test` rebuilds and checks the rendered title, core copy, data-source
  content, APEX CTA, social metadata, and removal of starter UI.
- `npm run lint` performs the source lint pass.

## Deployment

`.openai/hosting.json` connects this folder to its OpenAI Sites project. The
current configuration does not request D1 or R2 resources. Keep the Vinext
structure, lockfile, and Worker entry point intact when deploying.

Before deploying publicly, decide where **Try APEX Discovery** should lead. A
localhost URL is appropriate for an on-device demo but not for a shared hosted
agent unless each viewer runs APEX locally.

## Data, privacy, and security

- The current website has no sign-in requirement and no application database.
- It does not embed OpenAI credentials or scientific-service credentials.
- Data-source cards open third-party sites in a new tab.
- APEX authentication and research history belong to the separate APEX
  Discovery runtime, not this website.
- Do not add secrets to client-side code, committed environment files, or the
  standalone HTML snapshots.

## Common changes

### Add or update a source

Edit the `dataSources` array in `app/page.tsx`, using the source's official
homepage and a concise evidence-type label. Then run `npm test`.

### Change the APEX destination

Update `APEX_DISCOVERY_URL` in `app/page.tsx`. Keep the visible CTA and its
accessible label consistent.

### Change page metadata

Edit `generateMetadata()` in `app/layout.tsx`. If the visual identity changes,
replace `public/og.png` and verify the rendered Open Graph metadata.

## Scope

Molecules Opportunity Atlas is a navigation and positioning layer, not a
scientific database, ingestion monitor, or evidence-ranking engine. Scientific
claims and decisions should be generated and reviewed inside APEX Discovery
using the relevant source-linked tools.
