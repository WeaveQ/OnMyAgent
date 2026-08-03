/**
 * Sessions created inside expert-creation (coach / try-preview) are disposable.
 * They must not appear in the home "recent" task list or expert session buckets.
 */

import { EXPERT_CREATION_COACH_AGENT_ID } from "./agent-builtin";
import {
  readSessionAgentSnapshot,
  writeSessionAgentSnapshot,
} from "./agent-registry-store";

const STORAGE_KEY = "onmyagent:expert-creation-ephemeral-sessions";

const memoryIds = new Set<string>();

function readStored(): Set<string> {
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  if (!storage) return new Set(memoryIds);
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new Set(memoryIds);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(memoryIds);
    const next = new Set(memoryIds);
    for (const id of parsed) {
      if (typeof id === "string" && id.trim()) next.add(id.trim());
    }
    return next;
  } catch {
    return new Set(memoryIds);
  }
}

function writeStored(ids: Set<string>): void {
  memoryIds.clear();
  for (const id of ids) memoryIds.add(id);
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore quota / private mode
  }
}

export function registerExpertCreationEphemeralSession(sessionId: string): void {
  const id = sessionId.trim();
  if (!id || id.startsWith("draft:")) return;
  const ids = readStored();
  if (ids.has(id)) return;
  ids.add(id);
  writeStored(ids);
}

export function isExpertCreationEphemeralSession(sessionId: string): boolean {
  const id = sessionId.trim();
  if (!id) return false;
  if (readStored().has(id)) return true;
  const snapshot = readSessionAgentSnapshot(id);
  return snapshot?.id === EXPERT_CREATION_COACH_AGENT_ID
    || snapshot?.id.startsWith("preview-draft:") === true;
}

export function listExpertCreationEphemeralSessions(): string[] {
  return Array.from(readStored());
}

export function unregisterExpertCreationEphemeralSession(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  const ids = readStored();
  if (!ids.delete(id)) return;
  writeStored(ids);
}

export function clearExpertCreationEphemeralSessions(): string[] {
  const ids = Array.from(readStored());
  writeStored(new Set());
  return ids;
}

export type ExpertCreationSessionDeleteClient = {
  deleteSession: (
    workspaceId: string,
    sessionId: string,
    options?: { directory?: string },
  ) => Promise<unknown>;
};

export async function deleteExpertCreationEphemeralSession(input: {
  client: ExpertCreationSessionDeleteClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
}): Promise<void> {
  const sessionId = input.sessionId.trim();
  if (!sessionId || sessionId.startsWith("draft:")) return;
  await input.client.deleteSession(input.workspaceId, sessionId, {
    directory: input.workspaceRoot || undefined,
  });
  writeSessionAgentSnapshot(sessionId, null);
  unregisterExpertCreationEphemeralSession(sessionId);
}
