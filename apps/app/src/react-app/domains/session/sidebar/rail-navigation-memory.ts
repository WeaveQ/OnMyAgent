/**
 * Persist primary-rail navigation so leaving 本地/文件/管理 and returning
 * restores the last view (and assistant office/code category) per workspace.
 */
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import type { OnMyAgentPrimaryView } from "./main-rail";

export type ShellMode = "assistant" | "expert";

const RAIL_VIEW_STORAGE_KEY = "onmyagent.railView.v1";
const ASSISTANT_CATEGORY_STORAGE_KEY = "onmyagent.assistantCategory.v1";

const KNOWN_VIEWS = new Set<string>([
  "assistant",
  "chat",
  "localAgent",
  "files",
  "store",
  "projects",
  "agentManagement",
  "devices",
  "channels",
  "billing",
  "scheduledTasks",
  "agents",
  "skills",
  "connectors",
  "usage",
]);

function readJsonRecord(key: string): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return {};
  }
}

function writeJsonRecord(key: string, record: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // quota / private mode
  }
}

function railViewKey(mode: ShellMode, workspaceId: string) {
  return `${mode}:${workspaceId.trim()}`;
}

function parseView(value: unknown): OnMyAgentPrimaryView | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return KNOWN_VIEWS.has(value) ? (value as OnMyAgentPrimaryView) : null;
}

export function readRailView(
  mode: ShellMode,
  workspaceId: string,
  fallback: OnMyAgentPrimaryView,
): OnMyAgentPrimaryView {
  const id = workspaceId.trim();
  if (!id) return fallback;
  return parseView(readJsonRecord(RAIL_VIEW_STORAGE_KEY)[railViewKey(mode, id)]) ?? fallback;
}

export function writeRailView(
  mode: ShellMode,
  workspaceId: string,
  view: OnMyAgentPrimaryView,
) {
  const id = workspaceId.trim();
  if (!id) return;
  const record = readJsonRecord(RAIL_VIEW_STORAGE_KEY);
  record[railViewKey(mode, id)] = view;
  writeJsonRecord(RAIL_VIEW_STORAGE_KEY, record);
}

export function readAssistantCategoryMemory(
  workspaceId: string,
  fallback: AssistantCategoryId = "office",
): AssistantCategoryId {
  const id = workspaceId.trim();
  if (!id) return fallback;
  const value = readJsonRecord(ASSISTANT_CATEGORY_STORAGE_KEY)[id];
  return value === "code" || value === "office" ? value : fallback;
}

export function writeAssistantCategoryMemory(
  workspaceId: string,
  categoryId: AssistantCategoryId,
) {
  const id = workspaceId.trim();
  if (!id) return;
  const record = readJsonRecord(ASSISTANT_CATEGORY_STORAGE_KEY);
  record[id] = categoryId;
  writeJsonRecord(ASSISTANT_CATEGORY_STORAGE_KEY, record);
}

/** Secondary rail pages that should stay mounted after first visit. */
export const RAIL_KEEP_ALIVE_VIEWS = [
  "localAgent",
  "agentManagement",
  "files",
  "store",
  "scheduledTasks",
  "devices",
  "channels",
  "billing",
  "projects",
  "agents",
] as const satisfies readonly OnMyAgentPrimaryView[];

export type RailKeepAliveView = (typeof RAIL_KEEP_ALIVE_VIEWS)[number];

export function isRailKeepAliveView(view: string): view is RailKeepAliveView {
  return (RAIL_KEEP_ALIVE_VIEWS as readonly string[]).includes(view);
}
