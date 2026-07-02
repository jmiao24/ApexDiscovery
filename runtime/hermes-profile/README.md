# runtime/hermes-profile

The AI4S Workbench **Hermes profile distribution** — not just "call Hermes", but a
dedicated, installable profile.

A profile distribution bundles personality, skills, cron jobs, MCP connections, and
config as a Git repo the user installs with one command — without pulling in the
user's own memories, sessions, or API keys.

## Expected contents (to be added)

```text
distribution.yaml   # distribution manifest
SOUL.md             # personality / operating instructions
config.yaml         # profile config
mcp.json            # MCP connections
skills/             # profile-bundled skills
workflows/          # workflow templates
templates/          # project / report templates
```

Keep this independently maintained and versioned so runtime changes do not ripple
into the app.
