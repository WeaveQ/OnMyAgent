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
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_PROJECTS_DIR,
  WORKSPACE_TASKS_DIR,
  isExpertMentionPath,
  leftoverTaskCatalogEntries,
  mergeTaskSourceDirectoryTargets,
  prefixExpertRuntimeEntries,
  stripExpertRuntimePath,
  workspaceDirectoryTargets,
  workspaceDirectoryTargetsFromCatalog,
  workspaceMentionTargets,
} from "../../../capabilities/artifacts/workspace-mention-targets";
import { WORKSPACE_INBOX_DIR } from "../../workspace";
import {
  resolveWorkspaceRelativeDownloadPath,
  workspaceAttachmentContentType,
} from "./session-surface-helpers";

/**
 * Product @ roots (uploads/tasks/experts) live on the catalog workspace root.
 * Session cwd may be an isolated expert subdir — never pass it as catalog `root`,
 * or list paths become relative to the session while download resolves against
 * workspace.path and add silently 404s.
 */
export async function searchSessionMentionTargets(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  query: string;
}): Promise<ComposerMentionTarget[]> {
  const workspaceRoot = input.workspaceRoot.trim();
  const [workspaceItems, expertItems] = await Promise.all([
    (async () => {
      if (isElectronRuntime()) {
        if (!workspaceRoot) return [];
        const result = await listCodeWorkspaceFiles({
          workspacePath: workspaceRoot,
          recursive: true,
        });
        return result.items.map((item) => ({ ...item, revision: "" }));
      }
      const result = await input.client.listWorkspaceFiles(input.workspaceId, {
        includeDirs: true,
        limit: 10_000,
      });
      return result.items;
    })(),
    input.client
      .listExpertSessionFiles(input.workspaceId)
      .then((result) => prefixExpertRuntimeEntries(result.items))
      .catch(() => []),
  ]);
  return workspaceMentionTargets([...workspaceItems, ...expertItems], input.query);
}

export async function listSessionMentionFolder(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  path: string;
}): Promise<ComposerMentionTarget[]> {
  const workspaceRoot = input.workspaceRoot.trim();

  const listShallow = async (
    relativePath: string,
  ): Promise<ComposerMentionTarget[]> => {
    if (isElectronRuntime()) {
      if (!workspaceRoot) return [];
      const result = await listCodeWorkspaceFiles({
        workspacePath: workspaceRoot,
        relativePath,
      });
      return workspaceDirectoryTargets(
        result.items.map((item) => ({ ...item, revision: "" })),
      );
    }
    // Omit `root` so catalog paths stay workspace-relative (matches download API).
    const result = await input.client.listWorkspaceFiles(input.workspaceId, {
      includeDirs: true,
      limit: 10_000,
      prefix: relativePath,
      shallow: true,
    });
    return workspaceDirectoryTargets(result.items);
  };

  // Expert artifacts live in the managed runtime, not workspace/experts/.
  if (isExpertMentionPath(input.path) || input.path === WORKSPACE_EXPERTS_DIR) {
    const result = await input.client
      .listExpertSessionFiles(input.workspaceId)
      .catch(() => ({ items: [] }));
    return workspaceDirectoryTargetsFromCatalog(
      prefixExpertRuntimeEntries(result.items),
      input.path || WORKSPACE_EXPERTS_DIR,
    );
  }

  // Task source root also surfaces projects/ and leftover root files
  // (same Files → Task bucket).
  if (input.path === WORKSPACE_TASKS_DIR) {
    const [taskTargets, projectTargets, leftoverTargets] = await Promise.all([
      listShallow(WORKSPACE_TASKS_DIR),
      listShallow(WORKSPACE_PROJECTS_DIR).catch(() => []),
      (async () => {
        if (isElectronRuntime()) {
          if (!workspaceRoot) return [];
          const result = await listCodeWorkspaceFiles({
            workspacePath: workspaceRoot,
          });
          return workspaceDirectoryTargets(
            leftoverTaskCatalogEntries(
              result.items.map((item) => ({ ...item, revision: "" })),
            ),
          );
        }
        const result = await input.client.listWorkspaceFiles(input.workspaceId, {
          includeDirs: true,
          limit: 10_000,
          shallow: true,
        });
        return workspaceDirectoryTargets(leftoverTaskCatalogEntries(result.items));
      })().catch(() => []),
    ]);
    return mergeTaskSourceDirectoryTargets(
      mergeTaskSourceDirectoryTargets(taskTargets, projectTargets),
      leftoverTargets,
    );
  }

  return listShallow(input.path);
}

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function mimeForWorkspaceFile(
  path: string,
  contentType: string | null | undefined,
): string {
  const header = String(contentType ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (header && header !== "application/octet-stream") {
    return header;
  }
  return workspaceAttachmentContentType(path);
}

/** Download path candidates when catalog/inbox/session layouts disagree. */
export function mentionFileDownloadCandidates(
  workspaceRoot: string,
  filePath: string,
): string[] {
  const relative = resolveWorkspaceRelativeDownloadPath(workspaceRoot, filePath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!relative) return [];
  const name = basenamePath(relative);
  const candidates = [
    relative,
    name && name !== relative ? name : "",
    name ? `uploads/${name}` : "",
    name ? `${WORKSPACE_INBOX_DIR}/${name}` : "",
    name ? `${WORKSPACE_INBOX_DIR}/session-uploads/${name}` : "",
    relative.startsWith("uploads/")
      ? `${WORKSPACE_INBOX_DIR}/${relative}`
      : "",
    relative.startsWith("session-uploads/")
      ? `${WORKSPACE_INBOX_DIR}/${relative}`
      : "",
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.trim().replace(/\/+/g, "/");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export async function loadSessionMentionFiles(input: {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  paths: string[];
}): Promise<File[]> {
  const workspaceRoot = input.workspaceRoot.trim();
  const files = await Promise.all(
    input.paths.map(async (rawPath) => {
      const name = basenamePath(rawPath);
      if (isExpertMentionPath(rawPath)) {
        const runtimePath = stripExpertRuntimePath(rawPath);
        if (runtimePath) {
          try {
            const result = await input.client.downloadExpertSessionFile(
              input.workspaceId,
              runtimePath,
            );
            return new File([new Uint8Array(result.data)], name, {
              type: mimeForWorkspaceFile(runtimePath, result.contentType),
            });
          } catch {
            // Fall through to workspace copies if the same file was mirrored.
          }
        }
      }

      if (isElectronRuntime()) {
        if (!workspaceRoot) {
          throw new Error("workspace root is required");
        }
        const candidates = mentionFileDownloadCandidates(workspaceRoot, rawPath);
        let lastError: unknown = null;
        for (const relativePath of candidates) {
          try {
            const result = await readCodeWorkspaceBinaryFile({
              workspacePath: workspaceRoot,
              relativePath,
            });
            return new File([new Uint8Array(result.data)], name, {
              type: mimeForWorkspaceFile(relativePath, null),
            });
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError instanceof Error
          ? lastError
          : new Error("Failed to read workspace file");
      }

      const candidates = mentionFileDownloadCandidates(workspaceRoot, rawPath);
      let lastError: unknown = null;
      for (const relativePath of candidates) {
        try {
          const result = await input.client.downloadWorkspaceFile(
            input.workspaceId,
            relativePath,
          );
          return new File([new Uint8Array(result.data)], name, {
            type: mimeForWorkspaceFile(relativePath, result.contentType),
          });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("Failed to download workspace file");
    }),
  );
  return files;
}
