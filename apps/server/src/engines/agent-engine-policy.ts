/**
 * Workspace agent-engine defaulting and persist mapping.
 * Missing or invalid values are OpenCode. Only an explicit `"pi"` stays Pi.
 */

export type AgentEngineId = "opencode" | "pi";

export function normalizeAgentEngine(value: unknown): AgentEngineId {
  return value === "pi" ? "pi" : "opencode";
}

export function explicitAgentEngine(value: unknown): AgentEngineId | undefined {
  return value === "pi" || value === "opencode" ? value : undefined;
}

/** Copy a persisted engine onto a field-less CLI workspace. Never invent one. */
export function inheritPersistedAgentEngine<T extends { path?: string; agentEngine?: unknown }>(
  incoming: T,
  persisted: Array<{ path?: string; agentEngine?: unknown }>,
  pathKey: (path: string) => string = (value) => value.trim().replace(/\\/g, "/").toLowerCase(),
): T {
  if (explicitAgentEngine(incoming.agentEngine)) return incoming;
  const incomingKey = pathKey(String(incoming.path ?? ""));
  if (!incomingKey) return incoming;
  for (const entry of persisted) {
    if (pathKey(String(entry.path ?? "")) !== incomingKey) continue;
    const engine = explicitAgentEngine(entry.agentEngine);
    if (engine) return { ...incoming, agentEngine: engine };
  }
  return incoming;
}

/** Write `agentEngine` only when the workspace already has an explicit choice. */
export function persistAgentEngineField(
  value: unknown,
): { agentEngine: AgentEngineId } | Record<string, never> {
  if (value === "pi" || value === "opencode") {
    return { agentEngine: value };
  }
  return {};
}

export function readEngineCreateSessionInput(body: unknown): {
  title?: string;
  directory?: string;
  agentId?: string;
  model?: { providerID: string; modelID: string };
} {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const directory = typeof record.directory === "string" ? record.directory.trim() : "";
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  const model = readEngineModel(record.model);
  return {
    ...(title ? { title } : {}),
    ...(directory ? { directory } : {}),
    ...(agentId ? { agentId } : {}),
    ...(model ? { model } : {}),
  };
}

function readEngineModel(
  value: unknown,
): { providerID: string; modelID: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const providerID = typeof record.providerID === "string" ? record.providerID.trim() : "";
  const modelID = typeof record.modelID === "string" ? record.modelID.trim() : "";
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}
