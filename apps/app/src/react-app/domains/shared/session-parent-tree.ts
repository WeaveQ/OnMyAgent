/**
 * Walk parentID links so archive/delete/restore can treat a parent
 * session and its sub-agent children as one unit.
 */

export type SessionParentRef = {
  id: string;
  parentID?: string | null;
};

function normalizeId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function childrenByParentId(
  sessions: ReadonlyArray<SessionParentRef>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const session of sessions) {
    const id = normalizeId(session.id);
    const parentID = normalizeId(session.parentID);
    if (!id || !parentID) continue;
    const siblings = map.get(parentID) ?? [];
    siblings.push(id);
    map.set(parentID, siblings);
  }
  return map;
}

/** Direct and nested children of `rootId`. Does not include the root. */
export function collectSessionDescendantIds(
  sessions: ReadonlyArray<SessionParentRef>,
  rootId: string,
): string[] {
  const root = normalizeId(rootId);
  if (!root) return [];
  const childrenByParent = childrenByParentId(sessions);
  const descendants: string[] = [];
  const visited = new Set<string>([root]);
  const stack = [...(childrenByParent.get(root) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    descendants.push(id);
    const nested = childrenByParent.get(id);
    if (nested) stack.push(...nested);
  }
  return descendants;
}

/** Root first, then descendants. Always includes `rootId` when it is non-empty. */
export function collectSessionSubtreeIds(
  sessions: ReadonlyArray<SessionParentRef>,
  rootId: string,
): string[] {
  const root = normalizeId(rootId);
  if (!root) return [];
  return [root, ...collectSessionDescendantIds(sessions, root)];
}

/**
 * Hide sessions whose parent (or farther ancestor) is archived, even when the
 * child itself was not written into the archive store. Stops leaked sub-agents
 * from becoming Recent roots after the parent leaves the live list.
 */
export function excludeSessionsWithArchivedAncestor<T extends SessionParentRef>(
  sessions: ReadonlyArray<T>,
  archivedIds: ReadonlySet<string>,
): T[] {
  if (archivedIds.size === 0) return [...sessions];
  const byId = new Map(
    sessions.map((session) => [normalizeId(session.id), session] as const),
  );
  return sessions.filter((session) => {
    const seen = new Set<string>();
    let current = normalizeId(session.parentID);
    while (current && !seen.has(current)) {
      if (archivedIds.has(current)) return false;
      seen.add(current);
      current = normalizeId(byId.get(current)?.parentID);
    }
    return true;
  });
}
