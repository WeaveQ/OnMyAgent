/** Domain methods: Sessions for OnMyAgent server HTTP client. */
import type { Session } from "@opencode-ai/sdk/v2/client";
import type {
  SessionOriginListPayload,
  SessionOriginRecord,
  SessionOriginDeleteResult,
  SessionOriginUpsertPayload,
  WorkspaceSessionListPayload,
  WorkspaceSessionScope,
  ExpertDeleteRequest,
  ExpertDeleteResult,
} from "@onmyagent/types/server";
import type {
  AgentRuntimeCreateSessionInput,
  AgentRuntimeEventSnapshot,
  AgentRuntimeKind,
  AgentRuntimeModelCatalog,
  AgentRuntimeConnectorToolsResponse,
  AgentRuntimeCommandInput,
  AgentRuntimeCommandListResponse,
  AgentRuntimePromptAccepted,
  AgentRuntimePromptInput,
  AgentRuntimeSelectionConfig,
  AgentRuntimeSelectionResponse,
  AgentRuntimeSession,
  AgentRuntimeSessionListResponse,
  GrokBuildRuntimeSelection,
} from "@onmyagent/types/agent-runtime";
import {
  requestJson,
  requestStream,
  type OnMyAgentServerClientContext,
  type OnMyAgentSessionMessage,
  type OnMyAgentSessionSnapshot,
} from "./client-shared";

type SessionListResponse =
  | { items: Session[] }
  | (Omit<WorkspaceSessionListPayload, "items"> & { items: Session[] });

export function createSessionsClientMethods(ctx: OnMyAgentServerClientContext) {
  const { baseUrl, token, hostToken, timeouts, requestOpenCodeRouter, routerPath } = ctx;

  return {
    deleteSession: (workspaceId: string, sessionId: string, options?: { directory?: string }) => {
      const query = new URLSearchParams();
      if (options?.directory?.trim()) query.set("directory", options.directory.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return (
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}${suffix}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.deleteSession },
      )
      );
    },
    listSessions: (
      workspaceId: string,
      options?: {
        scope?: WorkspaceSessionScope;
        roots?: boolean;
        start?: number;
        search?: string;
        limit?: number;
        directory?: string;
        signal?: AbortSignal;
      },
    ) => {
      const query = new URLSearchParams();
      if (options?.scope) query.set("scope", options.scope);
      if (typeof options?.roots === "boolean") query.set("roots", String(options.roots));
      if (typeof options?.start === "number") query.set("start", String(options.start));
      if (options?.search?.trim()) query.set("search", options.search.trim());
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (options?.directory?.trim()) query.set("directory", options.directory.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionListResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead, signal: options?.signal },
      );
    },
    getSession: (workspaceId: string, sessionId: string, options?: { directory?: string }) => {
      const query = new URLSearchParams();
      if (options?.directory?.trim()) query.set("directory", options.directory.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return (
      requestJson<{ item: Session }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      )
      );
    },
    getSessionMessages: (workspaceId: string, sessionId: string, options?: { limit?: number; directory?: string }) => {
      const query = new URLSearchParams();
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (options?.directory?.trim()) query.set("directory", options.directory.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<{ items: OnMyAgentSessionMessage[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/messages${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionSnapshot: (
      workspaceId: string,
      sessionId: string,
      options?: { limit?: number; directory?: string; signal?: AbortSignal },
    ) => {
      const query = new URLSearchParams();
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (options?.directory?.trim()) query.set("directory", options.directory.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<{ item: OnMyAgentSessionSnapshot }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/snapshot${suffix}`,
        {
          token,
          hostToken,
          timeoutMs: timeouts.sessionRead,
          signal: options?.signal,
        },
      );
    },
    listSessionOrigins: (workspaceId: string, options?: { signal?: AbortSignal }) =>
      requestJson<SessionOriginListPayload>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-origins`,
        {
          token,
          hostToken,
          timeoutMs: timeouts.sessionRead,
          signal: options?.signal,
        },
      ),
    upsertSessionOrigin: (
      workspaceId: string,
      sessionId: string,
      payload: SessionOriginUpsertPayload,
    ) =>
      requestJson<{ item: SessionOriginRecord }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-origins/${encodeURIComponent(sessionId)}`,
        { token, hostToken, method: "PUT", body: payload, timeoutMs: timeouts.sessionRead },
      ),
    deleteSessionOrigin: (
      workspaceId: string,
      sessionId: string,
      options?: { expectedRevision?: number },
    ) => {
      const query = new URLSearchParams();
      if (typeof options?.expectedRevision === "number") {
        query.set("expectedRevision", String(options.expectedRevision));
      }
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionOriginDeleteResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-origins/${encodeURIComponent(sessionId)}${suffix}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.deleteSession },
      );
    },
    deleteExpert: (workspaceId: string, request: ExpertDeleteRequest) =>
      requestJson<ExpertDeleteResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/expert-delete`,
        {
          token,
          hostToken,
          method: "POST",
          body: request,
          timeoutMs: timeouts.deleteSession,
        },
      ),
    getAgentRuntimeSelection: (workspaceId?: string) => {
      const query = new URLSearchParams();
      if (workspaceId?.trim()) query.set("workspaceId", workspaceId.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return (
      requestJson<AgentRuntimeSelectionResponse>(
        baseUrl,
        `/agent-runtime/selection${suffix}`,
        { token, hostToken, timeoutMs: timeouts.status },
      )
      );
    },
    getAgentRuntimeModelCatalog: (
      workspaceId: string,
      runtimeKind?: AgentRuntimeKind,
    ) => {
      const query = new URLSearchParams();
      if (runtimeKind) query.set("runtimeKind", runtimeKind);
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<AgentRuntimeModelCatalog>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/runtime-models${suffix}`,
        { token, hostToken, timeoutMs: timeouts.status },
      );
    },
    getAgentRuntimeConnectorTools: (
      workspaceId: string,
      runtimeKind?: AgentRuntimeKind,
    ) => {
      const query = new URLSearchParams();
      if (runtimeKind) query.set("runtimeKind", runtimeKind);
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<AgentRuntimeConnectorToolsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/runtime-connectors${suffix}`,
        { token, hostToken, timeoutMs: timeouts.status },
      );
    },
    authenticateAgentRuntime: (
      workspaceId: string,
      runtimeKind: AgentRuntimeKind,
      methodId: string,
    ) => requestJson<AgentRuntimeModelCatalog>(
      baseUrl,
      `/workspace/${encodeURIComponent(workspaceId)}/runtime-authenticate`,
      {
        token,
        hostToken,
        method: "POST",
        body: { runtimeKind, methodId },
        timeoutMs: timeouts.config,
      },
    ),
    setDefaultAgentRuntime: (
      runtimeKind: AgentRuntimeKind,
      options?: { expectedRevision?: number },
    ) => requestJson<{ config: AgentRuntimeSelectionConfig }>(
      baseUrl,
      "/agent-runtime/selection/default",
      {
        token,
        hostToken,
        method: "POST",
        body: { runtimeKind, ...options },
        timeoutMs: timeouts.config,
      },
    ),
    setWorkspaceAgentRuntime: (
      workspaceId: string,
      runtimeKind: AgentRuntimeKind | null,
      options?: { expectedRevision?: number },
    ) => requestJson<{ config: AgentRuntimeSelectionConfig }>(
      baseUrl,
      `/agent-runtime/selection/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        token,
        hostToken,
        method: "POST",
        body: { runtimeKind, ...options },
        timeoutMs: timeouts.config,
      },
    ),
    setGrokBuildRuntimeSelection: (
      selection: GrokBuildRuntimeSelection | null,
      options?: { expectedRevision?: number },
    ) => requestJson<{ config: AgentRuntimeSelectionConfig }>(
      baseUrl,
      "/agent-runtime/selection/grok-build",
      {
        token,
        hostToken,
        method: "POST",
        body: { selection, ...options },
        timeoutMs: timeouts.config,
      },
    ),
    createRuntimeSession: (
      workspaceId: string,
      input: AgentRuntimeCreateSessionInput = {},
    ) => requestJson<{ session: AgentRuntimeSession }>(
      baseUrl,
      `/workspace/${encodeURIComponent(workspaceId)}/runtime-sessions`,
      {
        token,
        hostToken,
        method: "POST",
        body: input,
        timeoutMs: timeouts.sessionRead,
      },
    ),
    listRuntimeSessions: (workspaceId: string) =>
      requestJson<AgentRuntimeSessionListResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/runtime-sessions`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getRuntimeSession: (workspaceId: string, productSessionId: string) =>
      requestJson<{ session: AgentRuntimeSession }>(
        baseUrl,
        runtimeSessionPath(workspaceId, productSessionId),
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    deleteRuntimeSession: (workspaceId: string, productSessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        runtimeSessionPath(workspaceId, productSessionId),
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.deleteSession },
      ),
    renameRuntimeSession: (
      workspaceId: string,
      productSessionId: string,
      title: string,
    ) => requestJson<{ session: AgentRuntimeSession }>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/rename`,
      {
        token,
        hostToken,
        method: "POST",
        body: { title },
        timeoutMs: timeouts.config,
      },
    ),
    forkRuntimeSession: (
      workspaceId: string,
      productSessionId: string,
      newProductSessionId?: string,
      targetRuntimeKind?: AgentRuntimeKind,
    ) => requestJson<{ session: AgentRuntimeSession }>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/fork`,
      {
        token,
        hostToken,
        method: "POST",
        body: {
          ...(newProductSessionId ? { productSessionId: newProductSessionId } : {}),
          ...(targetRuntimeKind ? { targetRuntimeKind } : {}),
        },
        timeoutMs: timeouts.sessionRead,
      },
    ),
    promptRuntimeSession: (
      workspaceId: string,
      productSessionId: string,
      input: AgentRuntimePromptInput,
    ) => requestJson<AgentRuntimePromptAccepted>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/prompt`,
      {
        token,
        hostToken,
        method: "POST",
        body: input,
        timeoutMs: timeouts.sessionRead,
      },
    ),
    cancelRuntimeSession: (workspaceId: string, productSessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `${runtimeSessionPath(workspaceId, productSessionId)}/cancel`,
        { token, hostToken, method: "POST", body: {}, timeoutMs: timeouts.sessionRead },
      ),
    closeRuntimeSession: (workspaceId: string, productSessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `${runtimeSessionPath(workspaceId, productSessionId)}/close`,
        { token, hostToken, method: "POST", body: {}, timeoutMs: timeouts.sessionRead },
      ),
    resumeRuntimeSession: (workspaceId: string, productSessionId: string) =>
      requestJson<{ session: AgentRuntimeSession }>(
        baseUrl,
        `${runtimeSessionPath(workspaceId, productSessionId)}/resume`,
        { token, hostToken, method: "POST", body: {}, timeoutMs: timeouts.sessionRead },
      ),
    setRuntimeSessionModel: (
      workspaceId: string,
      productSessionId: string,
      modelRef: AgentRuntimeCreateSessionInput["modelRef"],
    ) => requestJson<{ session: AgentRuntimeSession }>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/model`,
      {
        token,
        hostToken,
        method: "POST",
        body: { modelRef },
        timeoutMs: timeouts.config,
      },
    ),
    setRuntimeSessionMode: (
      workspaceId: string,
      productSessionId: string,
      mode: string,
    ) => requestJson<{ session: AgentRuntimeSession }>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/mode`,
      {
        token,
        hostToken,
        method: "POST",
        body: { mode },
        timeoutMs: timeouts.config,
      },
    ),
    listRuntimeSessionCommands: (
      workspaceId: string,
      productSessionId: string,
    ) => requestJson<AgentRuntimeCommandListResponse>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/commands`,
      { token, hostToken, timeoutMs: timeouts.sessionRead },
    ),
    listRuntimeWorkspaceCommands: (
      workspaceId: string,
      runtimeKind: AgentRuntimeKind = "grok-build",
    ) => requestJson<{
      runtimeKind: AgentRuntimeKind;
      items: AgentRuntimeCommandListResponse["items"];
      complete: boolean;
    }>(
      baseUrl,
      `/workspace/${encodeURIComponent(workspaceId)}/runtime-commands?runtimeKind=${encodeURIComponent(runtimeKind)}`,
      { token, hostToken, timeoutMs: timeouts.sessionRead },
    ),
    executeRuntimeSessionCommand: (
      workspaceId: string,
      productSessionId: string,
      commandName: string,
      input: AgentRuntimeCommandInput = {},
    ) => requestJson<AgentRuntimePromptAccepted>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/commands/${encodeURIComponent(commandName)}`,
      {
        token,
        hostToken,
        method: "POST",
        body: input,
        timeoutMs: timeouts.sessionRead,
      },
    ),
    respondRuntimePermission: (
      permissionId: string,
      reply: "allow" | "deny",
    ) => requestJson<{ ok: boolean; allowed: boolean }>(
      baseUrl,
      `/approvals/${encodeURIComponent(permissionId)}`,
      {
        token,
        hostToken,
        method: "POST",
        body: { reply },
        timeoutMs: timeouts.sessionRead,
      },
    ),
    respondRuntimeQuestion: (
      workspaceId: string,
      productSessionId: string,
      questionId: string,
      answers: string[][],
    ) => requestJson<{ ok: boolean }>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/questions/${encodeURIComponent(questionId)}`,
      {
        token,
        hostToken,
        method: "POST",
        body: { answers },
        timeoutMs: timeouts.config,
      },
    ),
    openRuntimeSessionEvents: (
      workspaceId: string,
      productSessionId: string,
      options?: { signal?: AbortSignal },
    ) => requestStream(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/events`,
      { token, hostToken, signal: options?.signal },
    ),
    getRuntimeSessionEventSnapshot: (
      workspaceId: string,
      productSessionId: string,
      options?: { afterSequence?: number; limit?: number },
    ) => {
      const query = new URLSearchParams();
      if (typeof options?.afterSequence === "number") {
        query.set("afterSequence", String(options.afterSequence));
      }
      if (typeof options?.limit === "number") {
        query.set("limit", String(options.limit));
      }
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<AgentRuntimeEventSnapshot>(
        baseUrl,
        `${runtimeSessionPath(workspaceId, productSessionId)}/event-snapshot${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getRuntimeSessionMessages: (
      workspaceId: string,
      productSessionId: string,
    ) => requestJson<import("@onmyagent/types/agent-runtime").AgentRuntimeMessagesResponse>(
      baseUrl,
      `${runtimeSessionPath(workspaceId, productSessionId)}/messages`,
      { token, hostToken, timeoutMs: timeouts.sessionRead },
    ),
  };
}

function runtimeSessionPath(workspaceId: string, productSessionId: string): string {
  return `/workspace/${encodeURIComponent(workspaceId)}/runtime-sessions/${encodeURIComponent(productSessionId)}`;
}
