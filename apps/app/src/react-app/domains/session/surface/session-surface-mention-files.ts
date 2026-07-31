/**
 * Workspace file listing/load helpers for composer @ mention menus.
 * Kept out of session-surface.tsx to satisfy file-size baselines.
 */
import {
  listCodeWorkspaceFiles,
  readCodeWorkspaceBinaryFile,
} from "../../../../app/lib/desktop";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import { isElectronRuntime } from "../../../../app/utils";
import type { ComposerMentionTarget } from "../../../../app/types";
import {
  WORKSPACE_PROJECTS_DIR,
  WORKSPACE_TASKS_DIR,
  mergeTaskSourceDirectoryTargets,
  workspaceDirectoryTargets,
  workspaceMentionTargets,
} from "../../../capabilities/artifacts/workspace-mention-targets";
import { workspaceAttachmentContentType } from "./session-surface-helpers";

export async function searchSessionMentionTargets(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  query: string;
}): Promise<ComposerMentionTarget[]> {
  const workspaceRoot = input.workspaceRoot.trim();
  if (!workspaceRoot) return [];
  if (isElectronRuntime()) {
    const result = await listCodeWorkspaceFiles({ workspacePath: workspaceRoot });
    return workspaceMentionTargets(
      result.items.map((item) => ({ ...item, revision: "" })),
      input.query,
    );
  }
  const result = await input.client.listWorkspaceFiles(input.workspaceId, {
    includeDirs: true,
    limit: 10_000,
    root: workspaceRoot,
  });
  return workspaceMentionTargets(result.items, input.query);
}

export async function listSessionMentionFolder(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  path: string;
}): Promise<ComposerMentionTarget[]> {
  const workspaceRoot = input.workspaceRoot.trim();
  if (!workspaceRoot) return [];

  const listShallow = async (
    relativePath: string,
  ): Promise<ComposerMentionTarget[]> => {
    if (isElectronRuntime()) {
      const result = await listCodeWorkspaceFiles({
        workspacePath: workspaceRoot,
        relativePath,
      });
      return workspaceDirectoryTargets(
        result.items.map((item) => ({ ...item, revision: "" })),
      );
    }
    const result = await input.client.listWorkspaceFiles(input.workspaceId, {
      includeDirs: true,
      limit: 10_000,
      prefix: relativePath,
      root: workspaceRoot,
      shallow: true,
    });
    return workspaceDirectoryTargets(result.items);
  };

  // Task source root also surfaces projects/ (same Files → Task bucket).
  if (input.path === WORKSPACE_TASKS_DIR) {
    const [taskTargets, projectTargets] = await Promise.all([
      listShallow(WORKSPACE_TASKS_DIR),
      listShallow(WORKSPACE_PROJECTS_DIR).catch(() => []),
    ]);
    return mergeTaskSourceDirectoryTargets(taskTargets, projectTargets);
  }

  return listShallow(input.path);
}

export async function loadSessionMentionFiles(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  paths: string[];
}): Promise<File[]> {
  return Promise.all(
    input.paths.map(async (path) => {
      const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
      if (isElectronRuntime()) {
        const result = await readCodeWorkspaceBinaryFile({
          workspacePath: input.workspaceRoot,
          relativePath: path,
        });
        return new File([new Uint8Array(result.data)], name, {
          type: workspaceAttachmentContentType(path),
        });
      }
      const result = await input.client.downloadWorkspaceFile(
        input.workspaceId,
        path,
      );
      return new File([result.data], name, {
        type: result.contentType ?? "application/octet-stream",
      });
    }),
  );
}
