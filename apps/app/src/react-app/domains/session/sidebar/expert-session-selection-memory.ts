/**
 * Per-expert session tab memory: workspace + agentId → sessionId.
 * Selection is always by session id (never tab index).
 *
 * Reads are memoized in-process so expert list hover/open does not re-parse
 * localStorage on every row. Writes update the cache; external storage
 * changes are not observed (same process owns this key).
 */
const EXPERT_SESSION_SELECTION_KEY = "onmyagent.expertSessionSelection.v1";

let cachedRecord: Record<string, string> | null = null;

function memoryKey(workspaceId: string, agentId: string) {
  return `${workspaceId.trim()}:${agentId.trim()}`;
}

function parseRecord(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
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

function readRecord(): Record<string, string> {
  if (cachedRecord) return cachedRecord;
  if (typeof window === "undefined") {
    cachedRecord = {};
    return cachedRecord;
  }
  try {
    cachedRecord = parseRecord(
      window.localStorage.getItem(EXPERT_SESSION_SELECTION_KEY),
    );
  } catch {
    cachedRecord = {};
  }
  return cachedRecord;
}

/** Test / HMR helper — drop the in-memory cache so the next read hits storage. */
export function clearExpertSessionSelectionCache(): void {
  cachedRecord = null;
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
    const record = { ...readRecord() };
    record[memoryKey(ws, agent)] = session;
    cachedRecord = record;
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

/**
 * Session id to warm before opening an expert row (hover/focus).
 * Matches open-time resolveExpertSessionSelection so prefetch hits the
 * same snapshot SessionSurface will request.
 */
export function resolveExpertPrefetchSessionId(input: {
  workspaceId: string;
  agentId: string;
  sessionIds: readonly string[];
  orderIds?: readonly string[];
  fallbackSessionId?: string | null;
}): string | null {
  const agentId = input.agentId.trim();
  if (!agentId) {
    const fallback = input.fallbackSessionId?.trim() ?? "";
    return fallback && !fallback.startsWith("draft:") ? fallback : null;
  }
  const resolved = resolveExpertSessionSelection({
    rememberedSessionId: readExpertSessionSelection(
      input.workspaceId,
      agentId,
    ),
    sessionIds: input.sessionIds,
    orderIds: input.orderIds,
  });
  if (resolved) return resolved;
  const fallback = input.fallbackSessionId?.trim() ?? "";
  return fallback && !fallback.startsWith("draft:") ? fallback : null;
}
