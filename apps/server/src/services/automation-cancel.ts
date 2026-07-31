/**
 * Cancel an in-progress automation run lease without disabling the schedule.
 */
import type { AutomationTaskItem } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { listAutomations, recordAutomationRun } from "./automations.js";

export async function cancelAutomationRun(
  workspaceRoot: string,
  id: string,
  now = Date.now(),
): Promise<AutomationTaskItem> {
  const items = await listAutomations(workspaceRoot);
  const current = items.find((item) => item.id === id);
  if (!current) {
    throw new ApiError(404, "automation_not_found", "Automation task not found");
  }
  if (!current.running) {
    throw new ApiError(409, "automation_not_running", "Automation task is not running");
  }
  const running = current.running;
  const item = await recordAutomationRun(
    workspaceRoot,
    id,
    {
      status: "skipped",
      source: "manual",
      ranAt: now,
      error: "Cancelled by user",
      sessionId: running.sessionId,
      groupName: running.groupName,
      outputDirectory: running.outputDirectory,
    },
    running.leaseId,
  );
  if (!item || item.running) {
    throw new ApiError(409, "automation_not_running", "Automation task is not running");
  }
  return item;
}
