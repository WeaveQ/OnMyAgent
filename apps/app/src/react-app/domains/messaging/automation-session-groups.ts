import type { OnMyAgentAutomationTaskItem } from "../../../app/lib/onmyagent-server";
import {
  dispatchAssistantSessionWorkspacesChanged,
  writeAssistantSessionWorkspace,
} from "../session/sync/assistant-session-workspaces";
import { writeCustomAgentIdForSession } from "../agents/agent-registry-store";

export type AutomationSessionRecord = {
  sessionId: string;
  automationId: string;
  title: string;
  groupName: string;
  outputDirectory: string;
  category: OnMyAgentAutomationTaskItem["scene"];
  createdAt: number;
  agentId?: string;
};

export const automationSessionsChangedEvent = "onmyagent:automation-sessions-changed";
const storageKeyPrefix = "onmyagent.automationSessions.v1:";
const deletedStorageKeyPrefix = "onmyagent.deletedAutomationSessions.v1:";

function storageKey(workspaceId: string) {
  return `${storageKeyPrefix}${workspaceId}`;
}

function deletedStorageKey(workspaceId: string) {
  return `${deletedStorageKeyPrefix}${workspaceId}`;
}

function readDeletedSessionIds(workspaceId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(deletedStorageKey(workspaceId)) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeDeletedSessionIds(workspaceId: string, sessionIds: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    deletedStorageKey(workspaceId),
    JSON.stringify(Array.from(sessionIds)),
  );
}

function readRecord(value: unknown): AutomationSessionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("sessionId" in value) || typeof value.sessionId !== "string") return null;
  if (!("automationId" in value) || typeof value.automationId !== "string") return null;
  const title =
    "title" in value && typeof value.title === "string" && value.title.trim()
      ? value.title.trim()
      : "";
  if (!("groupName" in value) || typeof value.groupName !== "string") return null;
  if (!("outputDirectory" in value) || typeof value.outputDirectory !== "string") return null;
  const createdAt =
    "createdAt" in value && typeof value.createdAt === "number"
      ? value.createdAt
      : null;
  if (
    !("category" in value) ||
    !(value.category === "office" || value.category === "code")
  ) return null;
  return {
    sessionId: value.sessionId,
    automationId: value.automationId,
    title,
    groupName: value.groupName,
    outputDirectory: value.outputDirectory,
    category: value.category,
    createdAt: createdAt ?? 0,
    ...("agentId" in value && typeof value.agentId === "string" && value.agentId.trim()
      ? { agentId: value.agentId.trim() }
      : {}),
  };
}

function automationRecordForRun(
  automation: OnMyAgentAutomationTaskItem,
  run: { ranAt?: number; sessionId?: string; groupName?: string; outputDirectory?: string },
): AutomationSessionRecord | null {
  if (!run.sessionId || !run.groupName || !run.outputDirectory) return null;
  return {
    sessionId: run.sessionId,
    automationId: automation.id,
    title: automation.title,
    groupName: run.groupName,
    outputDirectory: run.outputDirectory,
    category: automation.scene,
    createdAt: run.ranAt ?? automation.createdAt,
    ...(automation.agent?.id ? { agentId: automation.agent.id } : {}),
  };
}

export function readAutomationSessionRecords(workspaceId: string): AutomationSessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(workspaceId)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => {
          const record = readRecord(item);
          return record ? [record] : [];
        })
      : [];
  } catch {
    return [];
  }
}

export function syncAutomationSessionRecords(
  workspaceId: string,
  automations: OnMyAgentAutomationTaskItem[],
) {
  if (typeof window === "undefined" || !workspaceId.trim()) return;
  const deletedSessionIds = readDeletedSessionIds(workspaceId);
  const existing = readAutomationSessionRecords(workspaceId);
  const records = new Map(existing.map((record) => [record.sessionId, record]));

  for (const automation of automations) {
    const running = automation.running;
    if (
      running?.sessionId &&
      running.groupName &&
      running.outputDirectory
    ) {
      const record = automationRecordForRun(automation, running);
      if (record && !deletedSessionIds.has(record.sessionId)) {
        records.set(running.sessionId, record);
      }
    }
    for (const run of automation.runs) {
      const record = automationRecordForRun(automation, run);
      if (record && !deletedSessionIds.has(record.sessionId)) {
        records.set(record.sessionId, record);
      }
    }
  }

  const next = Array.from(records.values());
  const recordsChanged =
    next.length !== existing.length ||
    next.some((record) => {
      const previous = existing.find((item) => item.sessionId === record.sessionId);
      return (
        previous?.automationId !== record.automationId ||
        previous?.title !== record.title ||
        previous?.groupName !== record.groupName ||
        previous?.outputDirectory !== record.outputDirectory ||
        previous?.category !== record.category ||
        previous?.createdAt !== record.createdAt ||
        previous?.agentId !== record.agentId
      );
    });
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
  let sessionWorkspaceChanged = false;
  for (const record of next) {
    sessionWorkspaceChanged = writeAssistantSessionWorkspace({
      sessionId: record.sessionId,
      ownerWorkspaceId: workspaceId,
      directory: record.outputDirectory,
    }) || sessionWorkspaceChanged;
    if (record.agentId) {
      writeCustomAgentIdForSession(record.sessionId, record.agentId);
    }
  }
  if (sessionWorkspaceChanged) {
    dispatchAssistantSessionWorkspacesChanged(workspaceId);
  }
  if (recordsChanged) {
    window.dispatchEvent(new CustomEvent(automationSessionsChangedEvent, {
      detail: { workspaceId },
    }));
  }
}

export function renameAutomationSessionRecord(
  workspaceId: string,
  sessionId: string,
  title: string,
) {
  if (typeof window === "undefined") return false;
  const id = sessionId.trim();
  const nextTitle = title.trim();
  if (!workspaceId.trim() || !id || !nextTitle) return false;
  const current = readAutomationSessionRecords(workspaceId);
  let changed = false;
  const next = current.map((record) => {
    if (record.sessionId !== id || record.title === nextTitle) return record;
    changed = true;
    return { ...record, title: nextTitle };
  });
  if (!changed) return false;
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(automationSessionsChangedEvent, {
    detail: { workspaceId },
  }));
  return true;
}

export function removeAutomationSessionRecord(
  workspaceId: string,
  sessionId: string,
) {
  if (typeof window === "undefined") return false;
  const id = sessionId.trim();
  if (!workspaceId.trim() || !id) return false;
  const deletedSessionIds = readDeletedSessionIds(workspaceId);
  deletedSessionIds.add(id);
  writeDeletedSessionIds(workspaceId, deletedSessionIds);
  const current = readAutomationSessionRecords(workspaceId);
  const next = current.filter((record) => record.sessionId !== id);
  const changed = next.length !== current.length;
  if (changed) {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
  }
  window.dispatchEvent(new CustomEvent(automationSessionsChangedEvent, {
    detail: { workspaceId },
  }));
  return changed;
}
