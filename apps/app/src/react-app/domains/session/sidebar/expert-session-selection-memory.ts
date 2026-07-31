/**
 * Per-expert session tab memory: workspace + agentId → sessionId.
 * Selection is always by session id (never tab index).
 */
const EXPERT_SESSION_SELECTION_KEY = "onmyagent.expertSessionSelection.v1";

function memoryKey(workspaceId: string, agentId: string) {
  return `${workspaceId.trim()}:${agentId.trim()}`;
}

function readRecord(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(EXPERT_SESSION_SELECTION_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) {
        out[key] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Last user-selected session id for this expert, or null. */
export function readExpertSessionSelection(
  workspaceId: string,
  agentId: string,
): string | null {
  const ws = workspaceId.trim();
  const agent = agentId.trim();
  if (!ws || !agent) return null;
  return readRecord()[memoryKey(ws, agent)] ?? null;
}

/** Persist user-selected session tab (by session id). */
export function writeExpertSessionSelection(
  workspaceId: string,
  agentId: string,
  sessionId: string,
): void {
  if (typeof window === "undefined") return;
  const ws = workspaceId.trim();
  const agent = agentId.trim();
  const session = sessionId.trim();
  if (!ws || !agent || !session || session.startsWith("draft:")) return;
  try {
    const record = readRecord();
    record[memoryKey(ws, agent)] = session;
    window.localStorage.setItem(
      EXPERT_SESSION_SELECTION_KEY,
      JSON.stringify(record),
    );
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Resolve which session tab to open for an expert:
 * 1. remembered session id if still present
 * 2. first real session in tab orderIds
 * 3. first real session in sessionIds
 */
export function resolveExpertSessionSelection(input: {
  rememberedSessionId?: string | null;
  sessionIds: readonly string[];
  orderIds?: readonly string[];
}): string | null {
  const realIds = input.sessionIds
    .map((id) => id.trim())
    .filter((id) => id && !id.startsWith("draft:"));
  const idSet = new Set(realIds);
  if (idSet.size === 0) return null;

  const remembered = input.rememberedSessionId?.trim() ?? "";
  if (remembered && idSet.has(remembered)) return remembered;

  for (const raw of input.orderIds ?? []) {
    const id = raw.trim();
    if (idSet.has(id)) return id;
  }

  return realIds[0] ?? null;
}
