# runtime/manager

The local Runtime Manager. Keeps the desktop installer light and installs the
scientific environment on demand.

Responsibilities:

- Detect APEX Runtime, Python / uv, Node, Git.
- Create and manage the workspace and per-project isolated environments.
- Install base Python packages and scientific tool dependencies on demand.
- Start / supervise the bundled APEX Runtime sidecar (and later the Jupyter Kernel Gateway).
- Manage ports; monitor runtime health.
- Write `provenance.jsonl`; collect logs.

## Runtime directory (per OS)

```text
macOS:   ~/Library/Application Support/AI4S Workbench/
Windows: %APPDATA%/AI4S Workbench/
generic: ~/.ai4s-workbench/
  config/  runtime/{apex-runtime,python,node}/  profiles/ai4s-workbench/
  workspaces/  logs/  cache/  secrets/
```

## Startup order

UI starts first → Runtime Manager checks dependencies → starts the APEX Runtime sidecar →
connects → loads projects. A failed APEX Runtime connection must not block the UI.
