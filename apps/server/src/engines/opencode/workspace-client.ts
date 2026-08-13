/**
 * Leaf module: build a fresh OpenCode SDK client for a workspace.
 * Kept out of opencode-proxy so the client pool can depend on this without
 * cycling through proxy → pool (logout).
 */
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { resolveWorkspaceOpencodeConnection } from "../../services/opencode-connection.js";

export function buildOpencodeDirectoryHeader(directory: string) {
  return /[^\x00-\x7F]/.test(directory)
    ? encodeURIComponent(directory)
    : directory;
}

export function createOpencodeDirectoryFetch(
  directory: string,
  authHeader?: string,
): typeof fetch {
  return Object.assign(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      // Merge request headers first, then init overrides — never drop Authorization.
      const headers = new Headers(request.headers);
      if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => {
          headers.set(key, value);
        });
      }
      headers.set(
        "x-opencode-directory",
        buildOpencodeDirectoryHeader(directory),
      );
      if (authHeader && !headers.has("Authorization")) {
        headers.set("Authorization", authHeader);
      }
      return fetch(new Request(request, { headers }));
    },
    { preconnect: fetch.preconnect },
  );
}

export function normalizeOpencodeDirectory(directory: string): string {
  // OpenCode stores/list-filters Windows sessions by regular drive paths
  // (`C:\Users\...`). Electron can persist local workspaces as extended-length
  // paths (`\\?\C:\Users\...`); passing those through as the directory query
  // makes OpenCode return an empty session list even though the sessions exist.
  if (process.platform === "win32") {
    return directory.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "");
  }
  return directory;
}

export function resolveOpencodeDirectory(workspace: WorkspaceInfo): string | null {
  const explicit = workspace.directory?.trim() ?? "";
  if (explicit) return normalizeOpencodeDirectory(explicit);
  if (workspace.workspaceType === "local")
    return normalizeOpencodeDirectory(workspace.path);
  return null;
}

/**
 * Build a fresh OpenCode SDK client (no pooling). Prefer
 * `getWorkspaceOpencodeClient` on hot paths.
 */
export function createWorkspaceOpencodeClient(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  directoryOverride?: string,
) {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const directory = directoryOverride?.trim() || resolveOpencodeDirectory(workspace);
  const directoryFetch = directory
    ? createOpencodeDirectoryFetch(directory, connection.authHeader)
    : undefined;

  return createOpencodeClient({
    baseUrl: connection.baseUrl?.trim(),
    ...(directory ? { directory } : {}),
    ...(directoryFetch ? { fetch: directoryFetch } : {}),
    ...(connection.authHeader
      ? { headers: { Authorization: connection.authHeader } }
      : {}),
  });
}
