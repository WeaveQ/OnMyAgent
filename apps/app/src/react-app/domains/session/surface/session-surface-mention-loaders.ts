/**
 * Session mention file search/list/load callbacks for SessionSurface.
 * Thin wrappers around session-surface-mention-files implementations.
 */
import { useCallback } from "react";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import {
  listSessionMentionFolder as listSessionMentionFolderImpl,
  loadSessionMentionFiles as loadSessionMentionFilesImpl,
  searchSessionMentionTargets as searchSessionMentionTargetsImpl,
} from "./session-surface-mention-files";

export function useSessionSurfaceMentionLoaders(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
}) {
  const { client, workspaceId, workspaceRoot } = input;

  const searchSessionMentionTargets = useCallback(
    (query: string) =>
      searchSessionMentionTargetsImpl({
        client,
        workspaceId,
        workspaceRoot,
        query,
      }),
    [client, workspaceId, workspaceRoot],
  );

  const listSessionMentionFolder = useCallback(
    (path: string) =>
      listSessionMentionFolderImpl({
        client,
        workspaceId,
        workspaceRoot,
        path,
      }),
    [client, workspaceId, workspaceRoot],
  );

  const loadSessionMentionFiles = useCallback(
    (paths: string[]) =>
      loadSessionMentionFilesImpl({
        client,
        workspaceId,
        workspaceRoot,
        paths,
      }),
    [client, workspaceId, workspaceRoot],
  );

  return {
    searchSessionMentionTargets,
    listSessionMentionFolder,
    loadSessionMentionFiles,
  };
}
