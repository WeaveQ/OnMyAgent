/**
 * Prefetch OpenCode provider list + managed inventory before Settings → Models.
 *
 * Safe to call from session shell, settings shell, or onboarding after a
 * workspace + runtime exists. Failures are swallowed — callers must not block UX.
 */
import type { Client } from "../../../../app/types";
import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import { createClient, waitForHealthy } from "../../../../app/lib/opencode";
import {
  resolveWorkspaceEndpoint,
  type LocalServerHandle,
} from "../../../../app/lib/workspace-endpoint";
import { getReactQueryClient } from "../../../infra/query-client";
import { ensureProviderListQuery } from "../../connections";
import { loadOpenCodeManagedProvidersForWorkspace } from "./ai-providers-controller";

export type PrewarmWorkspaceProvidersInput = {
  client: Client;
  baseUrl?: string | null;
  directory?: string | null;
  workspaceRoot?: string | null;
  /**
   * Session-route cold path: skip provider.list (composer model-catalog already
   * loads it on the critical path). Only warm managed-inventory IPC for Settings.
   */
  inventoryOnly?: boolean;
};

/**
 * Warm React Query provider.list cache and OpenCode inventory IPC cache.
 * Single-flight / TTL caches dedupe concurrent callers.
 */
export async function prewarmWorkspaceProviders(
  input: PrewarmWorkspaceProvidersInput,
): Promise<void> {
  const directory = (input.directory ?? input.workspaceRoot ?? "").trim();
  const workspaceRoot = (input.workspaceRoot ?? input.directory ?? "").trim();

  if (input.inventoryOnly) {
    if (!workspaceRoot) return;
    await loadOpenCodeManagedProvidersForWorkspace(workspaceRoot).catch(() => []);
    return;
  }

  await Promise.all([
    ensureProviderListQuery(getReactQueryClient(), {
      client: input.client,
      baseUrl: input.baseUrl,
      directory: directory || undefined,
    }).catch(() => null),
    workspaceRoot
      ? loadOpenCodeManagedProvidersForWorkspace(workspaceRoot).catch(() => [])
      : Promise.resolve([]),
  ]);
}

export type PrewarmProvidersForWorkspaceInput = {
  workspace: Pick<
    WorkspaceInfo,
    | "id"
    | "workspaceType"
    | "baseUrl"
    | "onmyagentHostUrl"
    | "onmyagentToken"
    | "onmyagentClientToken"
    | "onmyagentHostToken"
    | "onmyagentWorkspaceId"
    | "path"
  > | null | undefined;
  localServer: LocalServerHandle;
  /** Explicit workspace root when the list row path is empty. */
  directory?: string | null;
  /** How long to wait for OpenCode health before still attempting list fetch. */
  healthTimeoutMs?: number;
};

function resolveWorkspaceDirectory(
  workspace: PrewarmProvidersForWorkspaceInput["workspace"],
  fallback?: string | null,
): string {
  const fromWorkspace =
    typeof workspace?.path === "string" ? workspace.path.trim() : "";
  return (fromWorkspace || fallback || "").trim();
}

/**
 * Resolve endpoint → wait for healthy OpenCode → prewarm list + inventory.
 * Used after onboarding workspace create while the user is still on the profile step.
 */
export async function prewarmProvidersForWorkspace(
  input: PrewarmProvidersForWorkspaceInput,
): Promise<boolean> {
  const endpoint = resolveWorkspaceEndpoint(
    input.workspace,
    input.localServer,
  );
  if (!endpoint) return false;

  const directory = resolveWorkspaceDirectory(
    input.workspace,
    input.directory,
  );
  // Settings / session require a token on the OpenCode client; skip if missing.
  if (!endpoint.token) return false;

  const client = createClient(
    endpoint.opencodeBaseUrl,
    directory || undefined,
    {
      token: endpoint.token,
      mode: "onmyagent",
    },
  );

  try {
    await waitForHealthy(client, {
      timeoutMs: input.healthTimeoutMs ?? 20_000,
      pollMs: 400,
    });
  } catch {
    // Runtime may still be booting; attempt list/inventory anyway.
  }

  await prewarmWorkspaceProviders({
    client,
    baseUrl: endpoint.opencodeBaseUrl,
    directory: directory || undefined,
    workspaceRoot: directory || undefined,
  });
  return true;
}
