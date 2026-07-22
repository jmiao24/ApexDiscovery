# APEX Runtime profile

APEX Discovery runs its Codex bridge with an app-private configuration and data
profile. The host sets `XDG_CONFIG_HOME` and `XDG_DATA_HOME`; it never reads or
modifies a user's global agent configuration.

At startup the shared runtime layer:

- seeds the selected approval mode in `apex-runtime/config.json`;
- deploys bundled skills to `apex-runtime/skills/`;
- scopes execution to the active workspace; and
- protects the runtime directory with owner-only permissions where supported.

Project-specific skills belong in `.agents/skills/` inside the workspace.
