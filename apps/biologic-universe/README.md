# Biologic Universe

Biologic Universe is an interactive biologics landscape with an embedded
**Biologic Universe Agent**. The dashboard can be explored without AI; when the
local server is running, the Agent can collaborate on targets, assets,
modalities, stages, evidence, and opportunity hypotheses.

## How the system works

Biologic Universe has two operating modes built from the same research
snapshot:

1. **Offline dashboard** — open the generated HTML directly to explore assets,
   targets, modalities, stages, and evidence without an agent.
2. **Agent-enabled local app** — run `server.mjs` to add conversation history
   and a read-only Codex research partner.

```text
Browser dashboard
  |
  | POST /api/chat + selected dashboard context
  v
server.mjs
  |-- SQLite conversation history
  |-- Biologic Universe system prompt
  `-- OpenAI Codex SDK thread (read-only, no shell, no web)
          |
          | MCP over stdio
          v
biologic-universe-mcp.mjs
          |
          v
biologic-universe-query.mjs
          |
          v
results/prod_batch_001/viz/showcase_data.json
```

The browser sends the user's question plus any selected assets, targets,
modality gaps, or dashboard excerpts. `server.mjs` creates or resumes a Codex
thread and streams structured progress back to the browser as newline-delimited
JSON. Completed messages and expert-input questions are written to the local
SQLite history.

Codex receives one dataset tool: `BiologicUniverseQuery`. The MCP server
exposes bounded operations for summary, asset search, target profiles,
repurposing, modality gaps, asset comparison, and evidence. Results are capped
at 20 records so the full multi-megabyte snapshot is never placed in the model
context.

The agent is deliberately restricted:

- sandbox mode is read-only;
- shell and multi-agent features are disabled;
- network access and web search are disabled;
- dataset claims must come from `BiologicUniverseQuery`;
- source links may only use URLs already present in the snapshot.

This separation keeps deterministic data retrieval outside the model while
allowing Codex to compare evidence, explain patterns, and develop opportunity
hypotheses.

## Code responsibilities

- `viz/showcase_build.py` reads the research snapshot and generates the
  self-contained dashboard.
- `results/prod_batch_001/viz/showcase_data.json` is the fixed machine-readable
  snapshot used by the agent query layer.
- `results/prod_batch_001/viz/showcase.html` is the generated dashboard and
  includes the client-side Agent interface.
- `server.mjs` serves the dashboard, owns the Agent system prompt and Codex
  threads, exposes the local API, streams responses, and persists history.
- `biologic-universe-mcp.mjs` exposes the single read-only MCP tool.
- `biologic-universe-query.mjs` implements deterministic filtering,
  comparisons, evidence lookup, and result bounds.
- `test/` verifies history persistence, MCP safety annotations, and query
  behavior.

## Request lifecycle

```text
question + dashboard selection
  -> local /api/chat
  -> Codex thread with Biologic Universe system prompt
  -> one or more bounded MCP queries
  -> evidence-grounded response with available inline links
  -> streamed browser update
  -> local SQLite history
```

The model interprets the returned records, but it does not invent the records,
modify the snapshot, or silently supplement it with outside knowledge. Any
opportunity statement beyond observed snapshot facts should remain clearly
framed as interpretation or hypothesis.

## Give this folder to a coding agent

You can give the folder to Codex or another coding agent and use this prompt:

> Read `README.md` and launch the Biologic Universe demo for me. Use my existing
> Codex login if it is available. Do not ask me to paste an API key into chat and
> never print credentials. Install the locked dependencies, rebuild the
> dashboard, start the server, verify the health endpoint, and tell me the local
> URL. If authentication requires an interactive browser login, stop and tell me
> the exact command I should run myself.

The agent should follow the runbook below instead of inventing a different
deployment or modifying the research data.

## What the recipient needs

- macOS, Linux, or Windows
- Node.js **22.5 or later**
- npm
- One of the authentication options below if they want to use the Agent

The dashboard itself does not require OpenAI authentication. Authentication is
only needed for the collaborative Agent.

## Authentication: does every recipient need an API key?

**No.** For a local demo, each recipient can use their own Codex login.

### Option A — personal Codex/ChatGPT login (recommended for local testing)

Install the Codex CLI if it is not already available:

```bash
npm install --global @openai/codex
```

Sign in with the recipient's own ChatGPT account:

```bash
codex login
codex login status
```

Complete the browser login when prompted. If their ChatGPT plan/workspace
includes Codex, Agent usage follows that account's plan limits. The login is
cached locally by Codex and reused by this app. Do not copy your own Codex
credentials into the shared folder.

### Option B — the recipient's own OpenAI API key

The recipient may instead set an API key in the terminal before starting the
server.

macOS/Linux:

```bash
export OPENAI_API_KEY="your-key"
```

Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="your-key"
```

API-key usage is billed to that API account. Never place a real key in this
README, the HTML, source control, or client-side JavaScript. The server reads the
key from its environment; it is not sent to the browser.

OpenAI documents both authentication paths in its
[Codex authentication guide](https://learn.chatgpt.com/docs/auth).

## Agent runbook

Run these steps from the folder containing this README.

### 1. Check Node.js

```bash
node --version
```

If the version is older than 22.5, stop and ask the user to upgrade Node.js.

### 2. Install exactly the locked dependencies

```bash
npm ci
```

### 3. Rebuild the dashboard

```bash
npm run build
```

### 4. Check authentication

```bash
codex login status
```

If Codex is not signed in and `OPENAI_API_KEY` is not set, tell the user to
choose Option A or Option B above. Do not request that they paste a secret into
the conversation.

### 5. Start the server and keep it running

```bash
npm start
```

Open:

<http://127.0.0.1:8767>

### 6. Verify the server

In another terminal:

```bash
curl http://127.0.0.1:8767/api/health
```

Expected response:

```json
{"ok":true,"agent":"OpenAI Codex SDK","dataset":"prod_batch_001","history":"sqlite"}
```

The internal dataset identifier in this health response is implementation
metadata and is not shown in the product UI.

## If port 8767 is already in use

macOS/Linux:

```bash
PORT=8768 npm start
```

Windows PowerShell:

```powershell
$env:PORT="8768"; npm start
```

Then open <http://127.0.0.1:8768>.

## Conversation history and privacy

Conversation history is stored only on the local machine at:

```text
data/chat-history.sqlite
```

The UI supports conversation history, restore, rename, and delete. To use a
different location, set `BIOLOGIC_UNIVERSE_HISTORY_PATH` before starting the
server.

Do not distribute these files because they may contain private conversations:

```text
data/chat-history.sqlite
data/chat-history.sqlite-shm
data/chat-history.sqlite-wal
```

## Troubleshooting

### The page cannot be reached

- Confirm that the `npm start` terminal is still running.
- Confirm that the browser URL uses the same port printed by the server.
- Check `/api/health` using the command above.

### The Agent cannot authenticate

Run:

```bash
codex login status
```

If signed out, run `codex login`. If using an API key, confirm that
`OPENAI_API_KEY` was set in the same terminal that runs `npm start`.

### The Agent appears to be thinking for a long time

The first Agent turn can take roughly 30–60 seconds while the local Codex
runtime starts. The UI displays elapsed time. A turn is cancelled after three
minutes so the user can retry with a narrower question.

### `EADDRINUSE: address already in use`

Another process is already using the selected port. Use the alternate-port
instructions above, or stop the older server before restarting.

## Offline dashboard

Open `results/prod_batch_001/viz/showcase.html` directly to explore the
dashboard without starting a server. The dashboard and citation links work, but
the collaborative Agent and conversation history require `npm start`.

## Project structure

- `results/prod_batch_001/viz/showcase.html` — generated dashboard
- `results/prod_batch_001/viz/showcase_data.json` — embedded research data
- `viz/showcase_build.py` — dashboard builder
- `server.mjs` — local HTTP server, Agent API, and SQLite history
- `biologic-universe-query.mjs` — deterministic bounded query layer
- `biologic-universe-mcp.mjs` — read-only MCP tool used by Codex
- `test/` — server and query tests

The Agent never receives the entire multi-megabyte dataset in its context. Its
read-only query tool returns bounded target, asset, modality, and evidence
results.

## Development and verification

After changing the UI:

```bash
npm run build
```

Run the automated tests:

```bash
npm test
```

## Before sharing the folder

The sender should remove machine-specific and private files:

```bash
rm -rf node_modules
rm -f data/chat-history.sqlite data/chat-history.sqlite-shm data/chat-history.sqlite-wal
rm -f .env *.log
```

Keep `package-lock.json`, the generated dashboard, its data, and this README.
Send a ZIP or private repository rather than your live working directory.

## Hosting one shared demo

For a hosted demo, recipients should not provide credentials. The operator
configures an OpenAI API key only on the server and protects the application
with authentication, HTTPS, rate limits, and per-user data isolation. Do not use
or distribute one person's cached ChatGPT/Codex subscription credentials as the
authentication mechanism for a shared hosted service.
