# runtime/mcp

MCP (Model Context Protocol) server configurations.

## First batch

| MCP | Purpose | Phase |
| --- | --- | --- |
| `filesystem` | Project file read/write | v0.1 |
| `paper-search-mcp` | Literature search | v0.1 |
| `BioMCP` | Biomedical databases | later |
| `Zotero MCP` | Reference library | later |
| `GitHub MCP` | Repos / issues / releases | later |
| `local runtime MCP` | Local execution status | later |

The browser Settings page can register local STDIO and remote HTTP servers. The
Codex bridge converts the backend-neutral APEX shape into Codex `mcp_servers`
configuration on each turn and reports configured/connected/failed state.
Enabled plugins may bundle `.mcp.json`; their server names are namespaced by
plugin id. MCP credentials must be environment references (`$env:NAME` or
`${NAME}`), never literal secrets in a plugin package. Unknown tools default to
the `writes` approval policy.
