import type { SidebarSessionItem } from "../../../../app/types";
import { buildFilesOpenSessionMeta } from "./session-files-open-meta";

export function buildExpertPageFilesOpenSessionMeta(input: {
  workspaceId: string;
  workspaceRoot: string;
  workspaceSessions: SidebarSessionItem[];
  archivedSessionIds: ReadonlySet<string>;
}) {
  const liveSessions = input.workspaceSessions.filter(
    (session) => !input.archivedSessionIds.has(session.id),
  );
  return buildFilesOpenSessionMeta({
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    liveSessions,
  });
}
