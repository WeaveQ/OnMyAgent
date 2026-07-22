import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { createWorkspaceOpencodeClient } from "./opencode-proxy.js";

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
};

/**
 * Bounded cache of OpenCode SDK clients keyed by workspace + directory.
 * Caps growth on repeated proxy/automation use of the same workspace.
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
    workspace: WorkspaceInfo,
    directoryOverride?: string,
  ) => {
    const dir = directoryOverride?.trim() || workspace.directory?.trim() || workspace.path;
    return `${workspace.id}::${dir}`;
  };

  return {
    get(config, workspace, directoryOverride) {
      const key = keyFor(workspace, directoryOverride);
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
