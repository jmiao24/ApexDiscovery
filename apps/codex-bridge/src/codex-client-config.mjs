export function mainCodexConfig({ mcpServers, hasApexExecution, allowSubagents = true }) {
  const features = {
    ...(hasApexExecution ? { shell_tool: false } : {}),
    ...(!allowSubagents ? { multi_agent: false } : {}),
  };
  return {
    mcp_servers: mcpServers,
    ...(Object.keys(features).length ? { features } : {}),
  };
}
