import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import { createWorkspaceOpencodeClient } from "./opencode-workspace-client.js";

export type OpencodeClientFactory = (
  config: ServerConfig,
  workspace: WorkspaceInfo,
  directoryOverride?: string,
) => ReturnType<typeof createWorkspaceOpencodeClient>;

export type OpencodeClientPool = {
  get: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    directoryOverride?: string,
  ) => ReturnType<typeof createWorkspaceOpencodeClient>;
  size: () => number;
  clear: () => void;
  /** Drop all cache entries for a workspace id (any directory override). */
  clearWorkspace: (workspaceId: string) => void;
};

/**
 * Bounded cache of OpenCode SDK clients keyed by workspace + connection + directory.
 * Caps growth on repeated proxy/automation use of the same workspace.
 *
 * IMPORTANT: key must include baseUrl/auth. Managed OpenCode restarts on a new
 * port; a cache that only keys by workspace+directory keeps clients pointed at
 * the dead port and surfaces as "Unexpected server error" on snapshot/list.
 */
export function createOpencodeClientPool(options?: {
  maxEntries?: number;
  create?: OpencodeClientFactory;
}): OpencodeClientPool {
  const maxEntries = Math.max(1, options?.maxEntries ?? 32);
  const create = options?.create ?? createWorkspaceOpencodeClient;
  const cache = new Map<
    string,
    ReturnType<typeof createWorkspaceOpencodeClient>
  >();

  const keyFor = (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    directoryOverride?: string,
  ) => {
    const connection = resolveWorkspaceOpencodeConnection(config, workspace);
    const dir =
      directoryOverride?.trim() ||
      workspace.directory?.trim() ||
      workspace.path;
    const base = connection.baseUrl?.trim() || "";
    // Auth material changes with managed OpenCode restarts too.
    const auth = connection.authHeader?.trim() || "";
    return `${workspace.id}::${base}::${auth}::${dir}`;
  };

  return {
    get(config, workspace, directoryOverride) {
      const key = keyFor(config, workspace, directoryOverride);
      const existing = cache.get(key);
      if (existing) {
        // Refresh LRU order.
        cache.delete(key);
        cache.set(key, existing);
        return existing;
      }
      const client = create(config, workspace, directoryOverride);
      cache.set(key, client);
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return client;
    },
    size() {
      return cache.size;
    },
    clear() {
      cache.clear();
    },
    clearWorkspace(workspaceId: string) {
      const id = workspaceId.trim();
      if (!id) return;
      const prefix = `${id}::`;
      for (const key of [...cache.keys()]) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
    },
  };
}

export const defaultOpencodeClientPool = createOpencodeClientPool();


export function getWorkspaceOpencodeClient(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  directoryOverride?: string,
) {
  return defaultOpencodeClientPool.get(config, workspace, directoryOverride);
}

/** Invalidate pooled clients for a workspace after logout / dispose. */
export function clearWorkspaceOpencodeClients(workspace: WorkspaceInfo | string) {
  const id = typeof workspace === "string" ? workspace : workspace.id;
  defaultOpencodeClientPool.clearWorkspace(id);
}
