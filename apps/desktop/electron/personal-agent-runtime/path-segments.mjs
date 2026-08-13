const PERSONAL_AGENT_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

export function assertPersonalAgentPathSegment(value, label) {
  const segment = String(value ?? "");
  if (!PERSONAL_AGENT_PATH_SEGMENT.test(segment)) {
    throw new Error(`${label} must be a safe path segment`);
  }
  return segment;
}

export function personalAgentPartitionName(provider, agentId = "default") {
  const safeProvider = assertPersonalAgentPathSegment(provider, "provider");
  const safeAgentId = assertPersonalAgentPathSegment(agentId, "agent id");
  return `${safeProvider}-${safeAgentId}`;
}

export const __test__ = { PERSONAL_AGENT_PATH_SEGMENT };
