/**
 * Shared Files-rail session open metadata for assistant / expert / chat hosts.
 */
import { readAutomationSessionRecords } from "../../messaging";
import { readAssistantArchivedTasks } from "../../shared";
import {
  buildSessionIdByPathKeyFromAutomationRecords,
  buildSessionTitleByKey,
} from "../../workspace";

export type FilesOpenSessionMeta = {
  activeSessionIds: string[];
  archivedSessionIds: string[];
  sessionTitleByKey: Record<string, string>;
  sessionIdByPathKey: Record<string, string>;
};

export function buildFilesOpenSessionMeta(input: {
  workspaceId: string;
  liveSessions: ReadonlyArray<{ id?: string | null; title?: string | null }>;
}): FilesOpenSessionMeta {
  const workspaceId = input.workspaceId.trim();
  const archived = readAssistantArchivedTasks(workspaceId);
  const automationRecords = readAutomationSessionRecords(workspaceId);
  const { sessionIdByPathKey, pathTitleAliases } =
    buildSessionIdByPathKeyFromAutomationRecords(automationRecords);

  return {
    activeSessionIds: input.liveSessions
      .map((session) => String(session.id ?? "").trim())
      .filter(Boolean),
    archivedSessionIds: archived
      .map((task) => String(task.sessionId ?? "").trim())
      .filter(Boolean),
    sessionTitleByKey: buildSessionTitleByKey({
      liveSessions: input.liveSessions,
      archivedTasks: archived,
      pathTitleAliases: [
        ...pathTitleAliases,
        ...automationRecords.map((record) => ({
          key: record.sessionId,
          title: record.title,
        })),
      ],
    }),
    sessionIdByPathKey,
  };
}
