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
import {
  requestJson,
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
  };
}
