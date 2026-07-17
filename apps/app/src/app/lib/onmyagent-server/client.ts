/** OnMyAgent server HTTP client facade — composes domain method modules. */
export * from "./client-shared";

import type {
  ServerClientMethodArgsOf,
  ServerClientMethodFn,
  ServerClientMethodMap,
  ServerClientMethodName,
  ServerClientMethodResultOf,
} from "@onmyagent/types/server-client-method-map";
import {
  OnMyAgentServerError,
  requestJson,
  type OnMyAgentOpenCodeRouterResponse,
  type OnMyAgentServerClientContext,
  type OnMyAgentServerClientTimeouts,
} from "./client-shared";
import { createSystemClientMethods } from "./client-system";
import { createWorkspaceClientMethods } from "./client-workspace";
import { createSessionsClientMethods } from "./client-sessions";
import { createExtensionsClientMethods } from "./client-extensions";
import { createSessionArchiveClientMethods } from "./client-session-archive";

export type {
  ServerClientMethodArgsOf,
  ServerClientMethodFn,
  ServerClientMethodMap,
  ServerClientMethodName,
  ServerClientMethodResultOf,
} from "@onmyagent/types/server-client-method-map";

export function createOnMyAgentServerClient(options: {
  baseUrl: string;
  token?: string;
  hostToken?: string;
}) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const token = options.token;
  const hostToken = options.hostToken;

  const timeouts: OnMyAgentServerClientTimeouts = {
    health: 3_000,
    capabilities: 6_000,
    listWorkspaces: 8_000,
    activateWorkspace: 10_000,
    deleteWorkspace: 10_000,
    deleteSession: 12_000,
    sessionRead: 12_000,
    status: 6_000,
    config: 10_000,
    workspaceExport: 30_000,
    workspaceImport: 30_000,
    binary: 60_000,
  };

  const routerPath = (workspaceId: string, path: string) =>
    `/w/${encodeURIComponent(workspaceId)}/opencode-router${path}`;

  const requestOpenCodeRouter = async <T>(workspaceId: string, path: string) => {
    try {
      const json = await requestJson<T>(baseUrl, routerPath(workspaceId, path), {
        token,
        hostToken,
        timeoutMs: timeouts.status,
      });
      return { ok: true, json, status: 200 } satisfies OnMyAgentOpenCodeRouterResponse<T>;
    } catch (error) {
      if (error instanceof OnMyAgentServerError) {
        return { ok: false, json: null, status: error.status } satisfies OnMyAgentOpenCodeRouterResponse<T>;
      }
      throw error;
    }
  };

  const ctx: OnMyAgentServerClientContext = {
    baseUrl,
    token,
    hostToken,
    timeouts,
    requestOpenCodeRouter,
    routerPath,
  };

  return {
    ...createSystemClientMethods(ctx),
    ...createWorkspaceClientMethods(ctx),
    ...createSessionsClientMethods(ctx),
    ...createExtensionsClientMethods(ctx),
    ...createSessionArchiveClientMethods(ctx),
  };
}

export type OnMyAgentServerClient = ReturnType<typeof createOnMyAgentServerClient>;

/**
 * Typed method accessor: look up a client method by inventory name with
 * `ServerClientMethodMap` args/result. Prefer direct property access for call
 * sites; use this when the method name is dynamic.
 */
export function serverClientMethod<M extends ServerClientMethodName>(
  client: OnMyAgentServerClient,
  method: M,
): ServerClientMethodFn<M> {
  const fn = (client as Record<string, unknown>)[method];
  if (typeof fn !== "function" && method !== "baseUrl" && method !== "token") {
    throw new Error(`OnMyAgent server client method is not implemented: ${method}`);
  }
  if (method === "baseUrl" || method === "token") {
    return (() => (client as Record<string, unknown>)[method]) as ServerClientMethodFn<M>;
  }
  return (fn as ServerClientMethodFn<M>).bind(client);
}
