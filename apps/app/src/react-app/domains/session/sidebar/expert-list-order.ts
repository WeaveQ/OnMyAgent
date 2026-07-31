/**
 * Expert left-rail order — always stable after first seed.
 *
 * Activity timestamps, session snapshot loads, and open/tab switches must
 * NOT reshuffle rows. Pin moves between buckets; newcomers insert once at
 * the front of their bucket; relative order of known experts is frozen.
 */
export type ExpertListOrderItem = {
  agentId: string;
  name: string;
  /** Used only for first-seed / newcomer insert order. */
  updated: number;
  pinned: boolean;
};

const EXPERT_SIDEBAR_ORDER_STORAGE_KEY = "onmyagent.expertSidebarOrder.v1";

function recencyThenName(
  left: ExpertListOrderItem,
  right: ExpertListOrderItem,
): number {
  if (left.updated !== right.updated) return right.updated - left.updated;
  return left.name.localeCompare(right.name, "zh");
}

/**
 * Keep previous relative order for known ids; insert newcomers (by recency)
 * at the front of the bucket so a newly summoned expert is visible without
 * reshuffling the rest.
 */
export function mergeKeepOrderWithNewcomers(
  previousIds: readonly string[],
  currentIds: readonly string[],
  byId: ReadonlyMap<string, ExpertListOrderItem>,
): string[] {
  const currentSet = new Set(currentIds);
  const kept = previousIds.filter(
    (id, index) =>
      currentSet.has(id) && previousIds.indexOf(id) === index,
  );
  const keptSet = new Set(kept);
  const newcomers = currentIds
    .filter((id) => !keptSet.has(id))
    .sort((a, b) => {
      const left = byId.get(a);
      const right = byId.get(b);
      if (!left || !right) return a.localeCompare(b);
      return recencyThenName(left, right);
    });
  return [...newcomers, ...kept];
}

/**
 * Resolve expert agentId order for the left list.
 *
 * Always stable when `previousOrderIds` still overlaps the current set:
 * never re-sort known rows by `updated` (snapshot load / tab switch thrash).
 * Empty ledger seeds once by pin + recency, then freezes.
 */
export function resolveExpertListOrderIds(input: {
  items: readonly ExpertListOrderItem[];
  previousOrderIds: readonly string[];
}): string[] {
  const byId = new Map<string, ExpertListOrderItem>();
  for (const item of input.items) {
    const id = item.agentId.trim();
    if (!id) continue;
    byId.set(id, { ...item, agentId: id });
  }
  if (byId.size === 0) return [];

  const pinnedIds = input.items
    .map((item) => item.agentId.trim())
    .filter((id) => id && byId.get(id)?.pinned);
  const unpinnedIds = input.items
    .map((item) => item.agentId.trim())
    .filter((id) => id && !byId.get(id)?.pinned);

  const sortBucket = (ids: readonly string[]): string[] => {
    const unique = [...new Set(ids.filter((id) => byId.has(id)))];
    return unique.sort((a, b) =>
      recencyThenName(
        byId.get(a) as ExpertListOrderItem,
        byId.get(b) as ExpertListOrderItem,
      ),
    );
  };

  const hasStableLedger = input.previousOrderIds.some((id) => byId.has(id));
  const prevPinned = input.previousOrderIds.filter((id) => byId.get(id)?.pinned);
  const prevUnpinned = input.previousOrderIds.filter(
    (id) => byId.has(id) && !byId.get(id)?.pinned,
  );

  const orderedPinned = hasStableLedger
    ? mergeKeepOrderWithNewcomers(prevPinned, pinnedIds, byId)
    : sortBucket(pinnedIds);
  const orderedUnpinned = hasStableLedger
    ? mergeKeepOrderWithNewcomers(prevUnpinned, unpinnedIds, byId)
    : sortBucket(unpinnedIds);

  return [...orderedPinned, ...orderedUnpinned];
}

/** Apply resolved agentId order to decorated group rows. */
export function sortExpertListByOrderIds<
  T extends { group: { agentId?: string | null } },
>(rows: readonly T[], orderIds: readonly string[]): T[] {
  const index = new Map(
    orderIds.map((id, i) => [id, i] as const).filter(([id]) => id.length > 0),
  );
  return [...rows].sort((left, right) => {
    const leftId = left.group.agentId?.trim() ?? "";
    const rightId = right.group.agentId?.trim() ?? "";
    const li = index.has(leftId)
      ? (index.get(leftId) as number)
      : Number.MAX_SAFE_INTEGER;
    const ri = index.has(rightId)
      ? (index.get(rightId) as number)
      : Number.MAX_SAFE_INTEGER;
    if (li !== ri) return li - ri;
    return leftId.localeCompare(rightId);
  });
}

export function readExpertSidebarOrderIds(workspaceId: string): string[] {
  if (typeof window === "undefined") return [];
  const key = workspaceId.trim();
  if (!key) return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(EXPERT_SIDEBAR_ORDER_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const value = (parsed as Record<string, unknown>)[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function writeExpertSidebarOrderIds(
  workspaceId: string,
  agentIds: readonly string[],
): void {
  if (typeof window === "undefined") return;
  const key = workspaceId.trim();
  if (!key) return;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(EXPERT_SIDEBAR_ORDER_STORAGE_KEY) ?? "{}",
    );
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    const unique = Array.from(
      new Set(agentIds.map((id) => id.trim()).filter(Boolean)),
    );
    if (unique.length > 0) record[key] = unique;
    else delete record[key];
    window.localStorage.setItem(
      EXPERT_SIDEBAR_ORDER_STORAGE_KEY,
      JSON.stringify(record),
    );
  } catch {
    // ignore quota / private mode
  }
}
