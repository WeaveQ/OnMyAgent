/**
 * Permanent-delete helpers: resolve and remove workspace files owned by a session (C1).
 * Pure resolution is unit-tested; disk unlink is best-effort via the files API.
 */

import {
  candidateSessionOwnedRoots,
  filterPathsUnderSessionRoots,
} from "./workspace-files-layout";

export type SessionOwnedDeleteClient = {
  listWorkspaceFiles: (
    workspaceId: string,
    options?: {
      includeDirs?: boolean;
      limit?: number;
      prefix?: string;
    },
  ) => Promise<{ items: Array<{ path: string; kind?: string }> }>;
  deleteWorkspaceFile: (
    workspaceId: string,
    filePath: string,
    options?: { recursive?: boolean },
  ) => Promise<unknown>;
};

export type ResolveSessionOwnedPathsInput = {
  sessionId: string;
  directory?: string | null;
  agentSlug?: string | null;
  workspaceRoot?: string | null;
  /** Workspace-relative catalog paths (files preferred). */
  catalogPaths: readonly string[];
};

/** Pure: map session metadata + catalog → paths safe to unlink on permanent delete. */
export function resolveSessionOwnedFilePaths(
  input: ResolveSessionOwnedPathsInput,
): string[] {
  const roots = candidateSessionOwnedRoots({
    sessionId: input.sessionId,
    directory: input.directory,
    agentSlug: input.agentSlug,
    workspaceRoot: input.workspaceRoot,
  });
  return filterPathsUnderSessionRoots(input.catalogPaths, roots);
}

/**
 * Infer agent slug from a session directory path under experts/{slug}/….
 */
export function inferAgentSlugFromDirectory(
  directory: string | null | undefined,
): string | null {
  const rel = String(directory ?? "")
    .trim()
    .replace(/\\/g, "/");
  if (!rel) return null;
  const parts = rel.split("/").filter(Boolean);
  const expertsIdx = parts.findIndex(
    (p) => p.toLowerCase() === "experts",
  );
  if (expertsIdx >= 0 && parts[expertsIdx + 1]) {
    return parts[expertsIdx + 1] ?? null;
  }
  return null;
}

export type DeleteSessionOwnedFilesResult = {
  roots: string[];
  deleted: string[];
  failed: Array<{ path: string; error: string }>;
};

function isBenignDeleteError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("not found")
    || m.includes("enoent")
    || m.includes("no such file")
    || m.includes("does not exist")
  );
}

/**
 * Best-effort unlink of session-owned layout roots and listed files under them.
 * Does not throw on missing paths; returns per-path outcomes for callers/tests.
 */
export async function deleteSessionOwnedWorkspaceFiles(input: {
  client: SessionOwnedDeleteClient;
  workspaceId: string;
  sessionId: string;
  directory?: string | null;
  agentSlug?: string | null;
  workspaceRoot?: string | null;
}): Promise<DeleteSessionOwnedFilesResult> {
  const workspaceId = input.workspaceId.trim();
  const sessionId = input.sessionId.trim();
  const empty: DeleteSessionOwnedFilesResult = {
    roots: [],
    deleted: [],
    failed: [],
  };
  if (!workspaceId || !sessionId) return empty;

  const agentSlug =
    String(input.agentSlug ?? "").trim()
    || inferAgentSlugFromDirectory(input.directory)
    || null;

  const roots = candidateSessionOwnedRoots({
    sessionId,
    directory: input.directory,
    agentSlug,
    workspaceRoot: input.workspaceRoot,
  });
  if (roots.length === 0) return empty;

  const deleted: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  const seen = new Set<string>();

  // Prefer recursive root delete (tasks/{id}, experts/{slug}/{id}, metadata dir).
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    try {
      await input.client.deleteWorkspaceFile(workspaceId, root, {
        recursive: true,
      });
      deleted.push(root);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : String(cause ?? "delete failed");
      if (isBenignDeleteError(message)) {
        deleted.push(root);
        continue;
      }
      // Fall through: try individual files under this root from catalog.
      try {
        const catalog = await input.client.listWorkspaceFiles(workspaceId, {
          includeDirs: false,
          limit: 5000,
          prefix: root,
        });
        const paths = resolveSessionOwnedFilePaths({
          sessionId,
          directory: input.directory,
          agentSlug,
          workspaceRoot: input.workspaceRoot,
          catalogPaths: catalog.items.map((item) => item.path),
        });
        for (const path of paths) {
          if (seen.has(path)) continue;
          seen.add(path);
          try {
            await input.client.deleteWorkspaceFile(workspaceId, path);
            deleted.push(path);
          } catch (fileCause) {
            const fileMessage =
              fileCause instanceof Error
                ? fileCause.message
                : String(fileCause ?? "delete failed");
            if (isBenignDeleteError(fileMessage)) {
              deleted.push(path);
            } else {
              failed.push({ path, error: fileMessage });
            }
          }
        }
      } catch (listCause) {
        const listMessage =
          listCause instanceof Error
            ? listCause.message
            : String(listCause ?? "list failed");
        failed.push({ path: root, error: listMessage });
      }
    }
  }

  return { roots, deleted, failed };
}
