/** Domain methods: Sessions for OnMyAgent server HTTP client. */
import type { Session } from "@opencode-ai/sdk/v2/client";
import {
  requestJson,
  type OnMyAgentServerClientContext,
  type OnMyAgentSessionMessage,
  type OnMyAgentSessionSnapshot,
} from "./client-shared";

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
      options?: { roots?: boolean; start?: number; search?: string; limit?: number; directory?: string },
    ) => {
      const query = new URLSearchParams();
      if (typeof options?.roots === "boolean") query.set("roots", String(options.roots));
      if (typeof options?.start === "number") query.set("start", String(options.start));
      if (options?.search?.trim()) query.set("search", options.search.trim());
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (options?.directory?.trim()) query.set("directory", options.directory.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<{ items: Session[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
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
    getSessionSnapshot: (workspaceId: string, sessionId: string, options?: { limit?: number; directory?: string }) => {
      const query = new URLSearchParams();
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (options?.directory?.trim()) query.set("directory", options.directory.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<{ item: OnMyAgentSessionSnapshot }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/snapshot${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
  };
}
