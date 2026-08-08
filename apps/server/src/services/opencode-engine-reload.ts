import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import { clearWorkspaceOpencodeClients } from "./opencode-client-pool.js";
import { resolveOpencodeDirectory } from "./opencode-workspace-client.js";

/** Finish before the renderer's 10s request budget so it receives a typed 504. */
export const OPENCODE_ENGINE_RELOAD_TIMEOUT_MS = 8_000;

type FetchImpl = typeof fetch;

export function createOpencodeEngineReloader(options?: {
  fetch?: FetchImpl;
  timeoutMs?: number;
  clearClients?: (workspace: WorkspaceInfo) => void;
}) {
  const fetchImpl = options?.fetch ?? fetch;
  const timeoutMs = Math.max(1, options?.timeoutMs ?? OPENCODE_ENGINE_RELOAD_TIMEOUT_MS);
  const clearClients = options?.clearClients ?? clearWorkspaceOpencodeClients;
  const inflight = new Map<string, Promise<void>>();

  const reload = (config: ServerConfig, workspace: WorkspaceInfo): Promise<void> => {
    const key = workspace.id;
    const existing = inflight.get(key);
    if (existing) return existing;
    const pending = reloadOnce(config, workspace, fetchImpl, timeoutMs)
      .finally(() => {
        clearClients(workspace);
        inflight.delete(key);
      });
    inflight.set(key, pending);
    return pending;
  };

  return { reload };
}

async function reloadOnce(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  fetchImpl: FetchImpl,
  timeoutMs: number,
): Promise<void> {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const baseUrl = connection.baseUrl?.trim() ?? "";
  if (!baseUrl) {
    throw new ApiError(400, "opencode_unconfigured", "OpenCode base URL is missing for this workspace");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildReloadUrl(baseUrl, resolveOpencodeDirectory(workspace)), {
      method: "POST",
      headers: connection.authHeader ? { Authorization: connection.authHeader } : undefined,
      signal: controller.signal,
    });
    if (response.ok) return;
    throw new ApiError(502, "opencode_reload_failed", "OpenCode reload failed", {
      status: response.status,
      body: await parseErrorBody(response),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError(504, "opencode_reload_timeout", "OpenCode reload timed out", { timeoutMs });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildReloadUrl(baseUrl: string, directory?: string | null): string {
  try {
    const url = new URL(baseUrl);
    url.pathname = "/instance/dispose";
    url.search = "";
    if (directory) url.searchParams.set("directory", directory);
    return url.toString();
  } catch {
    throw new ApiError(400, "opencode_url_invalid", "OpenCode base URL is invalid");
  }
}

async function parseErrorBody(response: Response): Promise<unknown> {
  const text = (await response.text()).trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return text;
  }
}
