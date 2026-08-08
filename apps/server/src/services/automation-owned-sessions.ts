/**
 * Session ids owned by automation runs (running lease + history).
 * Used by archive sync and completion-owner UI to treat them as non-interactive.
 */
import type { AutomationTaskItem } from "@onmyagent/types/server";
import { listAutomations } from "./automations.js";

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

/** Load automation-owned OpenCode session ids for a workspace root. */
export async function loadAutomationOwnedSessionIds(
  workspaceRoot: string,
): Promise<Set<string>> {
  try {
    const items = await listAutomations(workspaceRoot);
    return collectAutomationOwnedSessionIds(items);
  } catch {
    return new Set();
  }
}
