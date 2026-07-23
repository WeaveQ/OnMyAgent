import type { AutomationTaskItem } from "@onmyagent/types";

export function automationsForSourceSession(
  items: readonly AutomationTaskItem[],
  sessionId: string | null | undefined,
) {
  const sourceSessionId = sessionId?.trim() ?? "";
  if (!sourceSessionId) return [];
  return items.filter(
    (item) => item.sourceSessionId?.trim() === sourceSessionId,
  );
}
