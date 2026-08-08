/**
 * Pure helpers: session ids owned by automation runs (running lease + history).
 * Used by archive sync and completion-owner UI to treat them as non-interactive.
 *
 * Keep this module free of imports from automations.ts to avoid circular deps.
 */
import type { AutomationTaskItem } from "@onmyagent/types/server";

export function collectAutomationOwnedSessionIds(
  items: ReadonlyArray<
    Pick<AutomationTaskItem, "running" | "lastRun" | "runs">
  >,
): Set<string> {
  const ids = new Set<string>();
  const add = (sessionId: string | undefined) => {
    const id = sessionId?.trim();
    if (id) ids.add(id);
  };
  for (const item of items) {
    add(item.running?.sessionId);
    add(item.lastRun?.sessionId);
    for (const run of item.runs ?? []) {
      add(run.sessionId);
    }
  }
  return ids;
}
