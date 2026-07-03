# runtime/opencode-profile

The AI4S Workbench **OpenCode profile** — the config + skills the app ships and applies
to the bundled OpenCode runtime (not a user's global OpenCode).

The desktop app runs OpenCode with an app-private config/data dir (isolated via
`XDG_CONFIG_HOME`/`XDG_DATA_HOME`), so nothing here touches `~/.config/opencode`.

## Contents (planned)

```text
opencode.json      # base config applied to the bundled runtime (providers, defaults)
skills/            # AI4S scientific skills (Markdown, agentskills.io format)
agents/            # optional custom agents
```

## How it maps at runtime

- The user's provider key (from Settings) is merged into the app-private `opencode.json`
  by the `configure_opencode` Rust command; the sidecar is restarted to pick it up.
- Skills placed here are surfaced to OpenCode via the workspace `.opencode/skill/` and
  appear on the app's Skills page (which lists OpenCode's real `GET /api/skill`).

Keep this bundle versioned with the app; it must not carry the user's own keys or sessions.
