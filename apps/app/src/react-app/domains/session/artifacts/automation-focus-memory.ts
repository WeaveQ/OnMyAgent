/**
 * One-shot focus target so "view automation" can open assistant scheduled tasks
 * and highlight/edit a specific automation id.
 */

import type { AutomationScene } from "@onmyagent/types";

const STORAGE_KEY = "onmyagent.automationFocus.v1";

export type AutomationFocusTarget = {
  workspaceId: string;
  automationId: string;
  scene: AutomationScene;
};

function readRecord(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return {};
  }
}

function writeRecord(record: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore
  }
}

export function writeAutomationFocus(target: AutomationFocusTarget) {
  const workspaceId = target.workspaceId.trim();
  const automationId = target.automationId.trim();
  if (!workspaceId || !automationId) return;
  const record = readRecord();
  record[workspaceId] = {
    automationId,
    scene: target.scene === "code" ? "code" : "office",
  };
  writeRecord(record);
}

export function consumeAutomationFocus(
  workspaceId: string,
): AutomationFocusTarget | null {
  const id = workspaceId.trim();
  if (!id) return null;
  const record = readRecord();
  const raw = record[id];
  delete record[id];
  writeRecord(record);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!("automationId" in raw) || typeof raw.automationId !== "string") return null;
  const automationId = raw.automationId.trim();
  if (!automationId) return null;
  const scene =
    "scene" in raw && raw.scene === "code" ? "code" : "office";
  return { workspaceId: id, automationId, scene };
}
