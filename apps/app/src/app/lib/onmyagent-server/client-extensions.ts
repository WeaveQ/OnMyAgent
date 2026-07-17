/** Domain methods: Extensions for OnMyAgent server HTTP client. */
import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";
import type { ArtifactPluginConnectionState } from "@onmyagent/types/artifact-plugin";
import {
  requestJson,
  type OnMyAgentServerClientContext,
  type OnMyAgentOpenCodeRouterHealthSnapshot,
  type OnMyAgentOpenCodeRouterTelegramConfig,
  type OnMyAgentOpenCodeRouterIdentityItem,
  type OnMyAgentOpenCodeRouterSendResult,
  type OnMyAgentOpenCodeRouterIdentityWriteResult,
  type OnMyAgentAutomationTaskItem,
  type OnMyAgentAutomationTaskInput,
  type OnMyAgentAutomationRunHistoryResult,
  type OnMyAgentCommandItem,
  type OnMyAgentPluginItem,
  type OnMyAgentSkillItem,
  type OnMyAgentSkillContent,
  type OnMyAgentHubSkillItem,
  type OnMyAgentHubRepo,
  type OnMyAgentMcpItem,
} from "./client-shared";

export function createExtensionsClientMethods(ctx: OnMyAgentServerClientContext) {
  const { baseUrl, token, hostToken, timeouts, requestOpenCodeRouter, routerPath } = ctx;

  return {
    listPlugins: (workspaceId: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<{ items: OnMyAgentPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins${query}`,
        { token, hostToken },
      );
    },
    listArtifactPlugins: (workspaceId: string) =>
      requestJson<{
        items: ArtifactPluginCatalogItem[];
        diagnostics: Array<{ pluginDirectory: string; message: string }>;
      }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifact-plugins`,
        { token, hostToken },
      ),
    getArtifactPlugin: (workspaceId: string, pluginId: string) =>
      requestJson<{
        item: ArtifactPluginCatalogItem;
        diagnostics: Array<{ pluginDirectory: string; message: string }>;
      }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifact-plugins/${encodeURIComponent(pluginId)}`,
        { token, hostToken },
      ),
    setArtifactPluginEnabled: (
      workspaceId: string,
      pluginId: string,
      enabled: boolean,
    ) =>
      requestJson<{ item: ArtifactPluginCatalogItem }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifact-plugins/${encodeURIComponent(pluginId)}/enabled`,
        { token, hostToken, method: "PUT", body: { enabled } },
      ),
    setArtifactPluginSkillEnabled: (
      workspaceId: string,
      pluginId: string,
      skillId: string,
      enabled: boolean,
    ) =>
      requestJson<{ item: ArtifactPluginCatalogItem["skills"][number] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifact-plugins/${encodeURIComponent(pluginId)}/skills/${encodeURIComponent(skillId)}/enabled`,
        { token, hostToken, method: "PUT", body: { enabled } },
      ),
    getArtifactPluginConnection: (workspaceId: string, pluginId: string) =>
      requestJson<ArtifactPluginConnectionState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifact-plugins/${encodeURIComponent(pluginId)}/connection`,
        { token, hostToken },
      ),
    addPlugin: (workspaceId: string, spec: string) =>
      requestJson<{ items: OnMyAgentPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins`,
        { token, hostToken, method: "POST", body: { spec } },
      ),
    removePlugin: (workspaceId: string, name: string) =>
      requestJson<{ items: OnMyAgentPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins/${encodeURIComponent(name)}`,
        { token, hostToken, method: "DELETE" },
      ),
    listSkills: (workspaceId: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<{ items: OnMyAgentSkillItem[] }>(
        baseUrl,
        `/workspace/${workspaceId}/skills${query}`,
        { token, hostToken },
      );
    },
    listHubSkills: (options?: { repo?: OnMyAgentHubRepo }) => {
      const params = new URLSearchParams();
      const owner = options?.repo?.owner?.trim();
      const repo = options?.repo?.repo?.trim();
      const ref = options?.repo?.ref?.trim();
      if (owner) params.set("owner", owner);
      if (repo) params.set("repo", repo);
      if (ref) params.set("ref", ref);
      const query = params.size ? `?${params.toString()}` : "";
      return requestJson<{ items: OnMyAgentHubSkillItem[] }>(baseUrl, `/hub/skills${query}`, {
        token,
        hostToken,
      });
    },
    installHubSkill: (
      workspaceId: string,
      name: string,
      options?: { overwrite?: boolean; repo?: { owner?: string; repo?: string; ref?: string } },
    ) =>
      requestJson<{ ok: boolean; name: string; path: string; action: "added" | "updated"; written: number; skipped: number }>(
        baseUrl,
        `/workspace/${workspaceId}/skills/hub/${encodeURIComponent(name)}`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            ...(options?.overwrite ? { overwrite: true } : {}),
            ...(options?.repo ? { repo: options.repo } : {}),
          },
        },
      ),
    getSkill: (workspaceId: string, name: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<OnMyAgentSkillContent>(
        baseUrl,
        `/workspace/${workspaceId}/skills/${encodeURIComponent(name)}${query}`,
        { token, hostToken },
      );
    },
    upsertSkill: (workspaceId: string, payload: { name: string; content: string; description?: string }) =>
      requestJson<OnMyAgentSkillItem>(baseUrl, `/workspace/${workspaceId}/skills`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    deleteSkill: (workspaceId: string, name: string) =>
      requestJson<{ path: string }>(
        baseUrl,
        `/workspace/${workspaceId}/skills/${encodeURIComponent(name)}`,
        {
          token,
          hostToken,
          method: "DELETE",
        },
      ),
    getOpenCodeRouterHealth: (workspaceId: string) =>
      requestOpenCodeRouter<OnMyAgentOpenCodeRouterHealthSnapshot>(workspaceId, "/health"),
    getOpenCodeRouterTelegram: (workspaceId: string) =>
      requestJson<OnMyAgentOpenCodeRouterTelegramConfig>(baseUrl, routerPath(workspaceId, "/config/telegram"), {
        token,
        hostToken,
        timeoutMs: timeouts.status,
      }),
    getOpenCodeRouterTelegramIdentities: (workspaceId: string) =>
      requestJson<{ ok: boolean; items: OnMyAgentOpenCodeRouterIdentityItem[] }>(
        baseUrl,
        routerPath(workspaceId, "/identities/telegram"),
        { token, hostToken, timeoutMs: timeouts.status },
      ),
    getOpenCodeRouterSlackIdentities: (workspaceId: string) =>
      requestJson<{ ok: boolean; items: OnMyAgentOpenCodeRouterIdentityItem[] }>(
        baseUrl,
        routerPath(workspaceId, "/identities/slack"),
        { token, hostToken, timeoutMs: timeouts.status },
      ),
    sendOpenCodeRouterMessage: (
      workspaceId: string,
      payload: { channel: "telegram" | "slack"; text: string; directory?: string; peerId?: string; autoBind?: boolean },
    ) =>
      requestJson<OnMyAgentOpenCodeRouterSendResult>(baseUrl, routerPath(workspaceId, "/send"), {
        token,
        hostToken,
        method: "POST",
        body: payload,
        timeoutMs: timeouts.status,
      }),
    upsertOpenCodeRouterTelegramIdentity: (
      workspaceId: string,
      payload: { token: string; access: "private" | "public"; enabled: boolean; pairingCode?: string },
    ) =>
      requestJson<OnMyAgentOpenCodeRouterIdentityWriteResult>(
        baseUrl,
        routerPath(workspaceId, "/identities/telegram"),
        { token, hostToken, method: "POST", body: payload, timeoutMs: timeouts.status },
      ),
    deleteOpenCodeRouterTelegramIdentity: (workspaceId: string, identityId: string) =>
      requestJson<OnMyAgentOpenCodeRouterIdentityWriteResult>(
        baseUrl,
        `${routerPath(workspaceId, "/identities/telegram")}/${encodeURIComponent(identityId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    upsertOpenCodeRouterSlackIdentity: (
      workspaceId: string,
      payload: { botToken: string; appToken: string; enabled: boolean },
    ) =>
      requestJson<OnMyAgentOpenCodeRouterIdentityWriteResult>(
        baseUrl,
        routerPath(workspaceId, "/identities/slack"),
        { token, hostToken, method: "POST", body: payload, timeoutMs: timeouts.status },
      ),
    deleteOpenCodeRouterSlackIdentity: (workspaceId: string, identityId: string) =>
      requestJson<OnMyAgentOpenCodeRouterIdentityWriteResult>(
        baseUrl,
        `${routerPath(workspaceId, "/identities/slack")}/${encodeURIComponent(identityId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    listMcp: (workspaceId: string) =>
      requestJson<{ items: OnMyAgentMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp`, { token, hostToken }),
    addMcp: (workspaceId: string, payload: { name: string; config: Record<string, unknown> }) =>
      requestJson<{ items: OnMyAgentMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    removeMcp: (workspaceId: string, name: string) =>
      requestJson<{ items: OnMyAgentMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp/${encodeURIComponent(name)}`, {
        token,
        hostToken,
        method: "DELETE",
      }),
    setMcpEnabled: (workspaceId: string, name: string, enabled: boolean) =>
      requestJson<{ items: OnMyAgentMcpItem[] }>(
        baseUrl,
        `/workspace/${workspaceId}/mcp/${encodeURIComponent(name)}/enabled`,
        {
          token,
          hostToken,
          method: "POST",
          body: { enabled },
        },
      ),

    logoutMcpAuth: (workspaceId: string, name: string) =>
      requestJson<{ ok: true }>(baseUrl, `/workspace/${workspaceId}/mcp/${encodeURIComponent(name)}/auth`, {
        token,
        hostToken,
        method: "DELETE",
      }),

    listCommands: (workspaceId: string, scope: "workspace" | "global" = "workspace") =>
      requestJson<{ items: OnMyAgentCommandItem[] }>(
        baseUrl,
        `/workspace/${workspaceId}/commands?scope=${scope}`,
        { token, hostToken },
      ),
    upsertCommand: (
      workspaceId: string,
      payload: { name: string; description?: string; template: string; agent?: string; model?: string | null; subtask?: boolean },
    ) =>
      requestJson<{ items: OnMyAgentCommandItem[] }>(baseUrl, `/workspace/${workspaceId}/commands`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    deleteCommand: (workspaceId: string, name: string) =>
      requestJson<{ ok: boolean }>(baseUrl, `/workspace/${workspaceId}/commands/${encodeURIComponent(name)}`, {
        token,
        hostToken,
        method: "DELETE",
      }),
    listAutomations: (workspaceId: string) =>
      requestJson<{ items: OnMyAgentAutomationTaskItem[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/automations`,
        { token, hostToken, timeoutMs: timeouts.status },
      ),
    listAutomationRuns: (workspaceId: string, automationId: string) =>
      requestJson<OnMyAgentAutomationRunHistoryResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/automations/${encodeURIComponent(automationId)}/runs`,
        { token, hostToken, timeoutMs: timeouts.status },
      ),
    createAutomation: (workspaceId: string, payload: OnMyAgentAutomationTaskInput) =>
      requestJson<{ item: OnMyAgentAutomationTaskItem; items: OnMyAgentAutomationTaskItem[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/automations`,
        { token, hostToken, method: "POST", body: payload, timeoutMs: timeouts.status },
      ),
    updateAutomation: (workspaceId: string, automationId: string, payload: Partial<OnMyAgentAutomationTaskInput>) =>
      requestJson<{ item: OnMyAgentAutomationTaskItem; items: OnMyAgentAutomationTaskItem[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/automations/${encodeURIComponent(automationId)}`,
        { token, hostToken, method: "PATCH", body: payload, timeoutMs: timeouts.status },
      ),
    runAutomation: (workspaceId: string, automationId: string) =>
      requestJson<{ item: OnMyAgentAutomationTaskItem; items: OnMyAgentAutomationTaskItem[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/automations/${encodeURIComponent(automationId)}/run`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.status },
      ),
    deleteAutomation: (workspaceId: string, automationId: string) =>
      requestJson<{ ok: boolean; items: OnMyAgentAutomationTaskItem[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/automations/${encodeURIComponent(automationId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
  };
}
