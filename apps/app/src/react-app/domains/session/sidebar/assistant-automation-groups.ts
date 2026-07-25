export type AssistantAutomationGroup<T> = {
  id: string;
  title: string;
  items: T[];
  updatedAt: number;
};

/**
 * Group sidebar sessions by automation task id.
 * When the user recreated the same template twice (same title, different ids),
 * fold them into one row so "历史上的今天" does not appear twice at the group level.
 */
export function groupAssistantAutomationItems<T>(
  entries: Array<{
    item: T;
    automationId: string;
    title: string;
    updatedAt: number;
  }>,
): AssistantAutomationGroup<T>[] {
  const byId = new Map<string, AssistantAutomationGroup<T>>();

  for (const entry of entries) {
    const current = byId.get(entry.automationId);
    if (current) {
      current.items.push(entry.item);
      current.title = entry.title.trim() || current.title;
      current.updatedAt = Math.max(current.updatedAt, entry.updatedAt);
      continue;
    }
    byId.set(entry.automationId, {
      id: entry.automationId,
      title: entry.title.trim() || entry.automationId,
      items: [entry.item],
      updatedAt: entry.updatedAt,
    });
  }

  // Collapse identical titles so recreate-from-template does not spawn twins.
  const byTitle = new Map<string, AssistantAutomationGroup<T>>();
  for (const group of byId.values()) {
    const key = group.title.toLowerCase();
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, group);
      continue;
    }
    // Keep the newer task's id as the group id; merge run sessions.
    if (group.updatedAt >= existing.updatedAt) {
      byTitle.set(key, {
        id: group.id,
        title: group.title,
        items: [...group.items, ...existing.items],
        updatedAt: group.updatedAt,
      });
    } else {
      existing.items.push(...group.items);
      existing.updatedAt = Math.max(existing.updatedAt, group.updatedAt);
    }
  }

  return Array.from(byTitle.values()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}
