/**
 * Shared Files-rail session open metadata for assistant / expert / chat hosts.
 */
import { readAutomationSessionRecords } from "../../messaging";
import { readAssistantArchivedTasks } from "../../shared";
import {
  buildSessionIdByPathKeyFromAutomationRecords,
  buildSessionIdByPathKeyFromSessionDirectories,
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
  workspaceRoot?: string | null;
  liveSessions: ReadonlyArray<{
    id?: string | null;
    title?: string | null;
    directory?: string | null;
  }>;
}): FilesOpenSessionMeta {
  const workspaceId = input.workspaceId.trim();
  const workspaceRoot = String(input.workspaceRoot ?? "").trim() || null;
  const archived = readAssistantArchivedTasks(workspaceId);
  const automationRecords = readAutomationSessionRecords(workspaceId);

  const fromAutomation =
    buildSessionIdByPathKeyFromAutomationRecords(automationRecords);
  // Expert isolation dirs (and any session with a bound directory) map
  // folder basename / product path → real session id for open + titles.
  const fromDirectories = buildSessionIdByPathKeyFromSessionDirectories(
    [
      ...input.liveSessions,
      ...archived.map((task) => ({
        id: task.sessionId,
        directory: task.directory,
        title: task.title,
      })),
    ],
    workspaceRoot,
  );

  const sessionIdByPathKey: Record<string, string> = {
    ...fromDirectories.sessionIdByPathKey,
    ...fromAutomation.sessionIdByPathKey,
  };

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
        ...fromDirectories.pathTitleAliases,
        ...fromAutomation.pathTitleAliases,
        ...automationRecords.map((record) => ({
          key: record.sessionId,
          title: record.title,
        })),
      ],
    }),
    sessionIdByPathKey,
  };
}
