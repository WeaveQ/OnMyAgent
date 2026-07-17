/** Domain methods: System for OnMyAgent server HTTP client. */
import type { ServerHealthResponse } from "@onmyagent/types/server";
import {
  requestJson,
  type OnMyAgentServerClientContext,
  type OnMyAgentServerCapabilities,
  type OnMyAgentServerDiagnostics,
  type OnMyAgentRuntimeSnapshot,
  type OnMyAgentAuditEntry,
  type OnMyAgentReloadEvent,
} from "./client-shared";

export function createSystemClientMethods(ctx: OnMyAgentServerClientContext) {
  const { baseUrl, token, hostToken, timeouts, requestOpenCodeRouter, routerPath } = ctx;

  return {
    baseUrl,
    token,
    health: () =>
      requestJson<ServerHealthResponse>(baseUrl, "/health", { token, hostToken, timeoutMs: timeouts.health }),
    runtimeVersions: () =>
      requestJson<OnMyAgentRuntimeSnapshot>(baseUrl, "/runtime/versions", { token, hostToken, timeoutMs: timeouts.status }),
    status: () => requestJson<OnMyAgentServerDiagnostics>(baseUrl, "/status", { token, hostToken, timeoutMs: timeouts.status }),
    capabilities: () => requestJson<OnMyAgentServerCapabilities>(baseUrl, "/capabilities", { token, hostToken, timeoutMs: timeouts.capabilities }),
    getConfig: (workspaceId: string) =>
      requestJson<{ opencode: Record<string, unknown>; onmyagent: Record<string, unknown>; updatedAt?: number | null }>(
        baseUrl,
        `/workspace/${workspaceId}/config`,
        { token, hostToken, timeoutMs: timeouts.config },
      ),
    patchConfig: (workspaceId: string, payload: { opencode?: Record<string, unknown>; onmyagent?: Record<string, unknown> }) =>
      requestJson<{ updatedAt?: number | null }>(baseUrl, `/workspace/${workspaceId}/config`, {
        token,
        hostToken,
        method: "PATCH",
        body: payload,
      }),
    listReloadEvents: (workspaceId: string, options?: { since?: number }) => {
      const query = typeof options?.since === "number" ? `?since=${options.since}` : "";
      return requestJson<{ items: OnMyAgentReloadEvent[]; cursor?: number }>(
        baseUrl,
        `/workspace/${workspaceId}/events${query}`,
        { token, hostToken },
      );
    },
    reloadEngine: (workspaceId: string) =>
      requestJson<{ ok: boolean; reloadedAt?: number }>(baseUrl, `/workspace/${workspaceId}/engine/reload`, {
        token,
        hostToken,
        method: "POST",
      }),
    listAudit: (workspaceId: string, limit = 50) =>
      requestJson<{ items: OnMyAgentAuditEntry[] }>(
        baseUrl,
        `/workspace/${workspaceId}/audit?limit=${limit}`,
        { token, hostToken },
      ),
    listUserEnvKeys: () =>
      requestJson<{ keys: string[] }>(
        baseUrl,
        "/env/keys",
        { token, hostToken, timeoutMs: timeouts.config },
      ),

    listUserEnv: () =>
      requestJson<{ items: Array<{ key: string; value: string; updatedAt: number }> }>(
        baseUrl,
        "/env",
        { token, hostToken, timeoutMs: timeouts.config },
      ),

    upsertUserEnv: (entries: Array<{ key: string; value: string }>) =>
      requestJson<{ ok: true; count: number }>(baseUrl, "/env", {
        token,
        hostToken,
        method: "PUT",
        body: { entries },
        timeoutMs: timeouts.config,
      }),

    deleteUserEnv: (key: string) =>
      requestJson<{ ok: true }>(baseUrl, `/env/${encodeURIComponent(key)}`, {
        token,
        hostToken,
        method: "DELETE",
        timeoutMs: timeouts.config,
      }),

    createVoiceRealtimeSession: (payload?: { model?: string }) =>
      requestJson<{
        ok: true;
        clientSecret: string;
        expiresAt: number | null;
        model: string;
        transcriptionModel: string;
        tools: string[];
      }>(baseUrl, "/voice/realtime/session", {
        token,
        hostToken,
        method: "POST",
        body: payload ?? {},
        timeoutMs: timeouts.config,
      }),
  };
}
