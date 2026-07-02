# packages/sdk

`HermesClient` — the single boundary between the app and the agent runtime.

The UI never calls Hermes directly. This package wraps the transport so the runtime
can change without touching the frontend:

- Primary: Hermes **TUI Gateway JSON-RPC** (over WebSocket) — sessions, slash commands,
  approvals, streaming events (`message.delta`, `tool.start`, `tool.progress`,
  `tool.complete`, `approval.request`).
- Fallback: **OpenAI-compatible HTTP API Server** for quick chat wiring.

Responsibilities: connect/reconnect, send prompts, normalize streamed events into the
shared event types (`packages/shared`), pin the supported Hermes version.
