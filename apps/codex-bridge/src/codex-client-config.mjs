export function mainCodexConfig({ mcpServers, hasApexExecution, allowSubagents = true }) {
  const features = {
    ...(!allowSubagents ? { multi_agent: false } : {}),
  };
  return {
    mcp_servers: mcpServers,
    ...(Object.keys(features).length ? { features } : {}),
  };
}

export function apexExecutionMcpConfig({ processPath, scienceMcpPath, workspaceRoot, sessionId, executionMode }) {
  if (executionMode !== "workspace-write" && executionMode !== "danger-full-access") {
    throw new Error(`unsupported APEX execution mode: ${executionMode}`);
  }
  return {
    apex_execution: {
      command: processPath,
      args: [scienceMcpPath],
      env: {
        APEX_WORKSPACE_ROOT: workspaceRoot,
        APEX_SESSION_ID: sessionId,
        APEX_EXECUTION_MODE: executionMode,
      },
      enabled: true,
      default_tools_approval_mode: "writes",
    },
  };
}
