# packages/sdk

`ApexRuntimeClient` — the single boundary between the app and the agent runtime.

The UI never calls APEX Runtime directly. This package wraps the transport so the runtime
can change without touching the frontend:

- Talks to a running APEX Runtime bridge over its HTTP + SSE API:
  - `POST /session` (create), `POST /session/:id/prompt_async` (start or steer a prompt).
  - `POST /session/:id/abort` (interrupt), plus question/permission recovery and replies.
  - `GET /event` (SSE) — `message.part.updated` (text / tool parts), `session.idle`, `session.error`.
- Normalizes APEX Runtime's idempotent "updated" events into a small app-facing event union
  (`text.updated`, `tool.updated`, `session.idle`, `error`) so the UI upserts by part/call id.
- Pins the supported APEX Runtime version (`APEX_RUNTIME_API_VERSION`).

`mockServer.ts` provides a minimal APEX Runtime API server for tests and local dev.
