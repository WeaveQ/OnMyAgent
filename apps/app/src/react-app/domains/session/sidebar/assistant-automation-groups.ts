export type AssistantAutomationGroup<T> = {
  id: string;
  title: string;
  items: T[];
  updatedAt: number;
};

export function groupAssistantAutomationItems<T>(
  entries: Array<{
    item: T;
    automationId: string;
    title: string;
    updatedAt: number;
  }>,
): AssistantAutomationGroup<T>[] {
  const groups = new Map<string, AssistantAutomationGroup<T>>();

  for (const entry of entries) {
    const current = groups.get(entry.automationId);
    if (current) {
      current.items.push(entry.item);
      current.title = entry.title;
      current.updatedAt = Math.max(current.updatedAt, entry.updatedAt);
      continue;
    }
    groups.set(entry.automationId, {
      id: entry.automationId,
      title: entry.title,
      items: [entry.item],
      updatedAt: entry.updatedAt,
    });
  }

  return Array.from(groups.values()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}
