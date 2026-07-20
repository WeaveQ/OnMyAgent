/** Domain methods: SessionArchive for OnMyAgent server HTTP client. */
import type {
  SessionArchiveAnalyticsActivityResponse,
  SessionArchiveAnalyticsHeatmapResponse,
  SessionArchiveAnalyticsHourOfWeekResponse,
  SessionArchiveAnalyticsProjectsResponse,
  SessionArchiveAnalyticsBatchResponse,
  SessionArchiveAnalyticsSessionShapeResponse,
  SessionArchiveAnalyticsSignalSessionsResponse,
  SessionArchiveAnalyticsSignalsResponse,
  SessionArchiveAnalyticsSkillsResponse,
  SessionArchiveAnalyticsSummary,
  SessionArchiveAnalyticsToolsResponse,
  SessionArchiveAnalyticsTopSessionsResponse,
  SessionArchiveAnalyticsVelocityResponse,
  SessionArchiveActivityReport,
  SessionArchiveApplyWorktreeMappingsResponse,
  SessionArchiveBackendsStatusResponse,
  SessionArchiveGenerateInsightRequest,
  SessionArchiveConfigSnapshot,
  SessionArchiveConfigUpdate,
  SessionArchiveInsightsResponse,
  SessionArchiveImportStats,
  SessionArchiveExportResponse,
  SessionArchiveLifecycleStatus,
  SessionArchiveMessagesResponse,
  SessionArchiveOpenSessionResponse,
  SessionArchivePinsResponse,
  SessionArchivePublishResponse,
  SessionArchiveResumeSessionResponse,
  SessionArchiveSearchResponse,
  SessionArchiveSecretConfidence,
  SessionArchiveSecretFindingsResponse,
  SessionArchiveSecretScanSummary,
  SessionArchiveSession,
  SessionArchiveSessionPage,
  SessionArchiveSessionSearchResponse,
  SessionArchiveStarredResponse,
  SessionArchiveSyncResult,
  SessionArchiveSyncStatus,
  SessionArchiveSessionUsage,
  SessionArchiveTopUsageSession,
  SessionArchiveTrendsTermsResponse,
  SessionArchiveUploadImportRequest,
  SessionArchiveUsageComparison,
  SessionArchiveUsageSummaryResponse,
  SessionArchiveWorktreeMapping,
  SessionArchiveWorktreeMappingsResponse,
  SessionArchiveWorktreeMappingInput,
} from "@onmyagent/types/session-archive";
import {
  requestJson,
  requestStream,
  requestText,
  type OnMyAgentServerClientContext,
} from "./client-shared";

export function createSessionArchiveClientMethods(ctx: OnMyAgentServerClientContext) {
  const { baseUrl, token, hostToken, timeouts, requestOpenCodeRouter, routerPath } = ctx;

  return {
    listSessionArchiveSessions: (
      workspaceId: string,
      options?: { start?: number; cursor?: string; search?: string; limit?: number; agent?: string },
    ) => {
      const query = new URLSearchParams();
      if (typeof options?.start === "number") query.set("start", String(options.start));
      if (options?.cursor?.trim()) query.set("cursor", options.cursor.trim());
      if (options?.search?.trim()) query.set("search", options.search.trim());
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (options?.agent?.trim()) query.set("agent", options.agent.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveSessionPage>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveSession: (workspaceId: string, sessionId: string) =>
      requestJson<{ item: SessionArchiveSession }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    openSessionArchiveEventsStream: (workspaceId: string, options?: { pollMs?: number; signal?: AbortSignal }) => {
      const query = new URLSearchParams();
      if (typeof options?.pollMs === "number") query.set("poll_ms", String(options.pollMs));
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestStream(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/events${suffix}`,
        { token, hostToken, signal: options?.signal },
      );
    },
    openSessionArchiveSessionWatchStream: (workspaceId: string, sessionId: string, options?: { pollMs?: number; signal?: AbortSignal }) => {
      const query = new URLSearchParams();
      if (typeof options?.pollMs === "number") query.set("poll_ms", String(options.pollMs));
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestStream(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/watch${suffix}`,
        { token, hostToken, signal: options?.signal },
      );
    },
    getSessionArchiveMessages: (workspaceId: string, sessionId: string, options?: { limit?: number; direction?: "asc" | "desc"; from?: number }) => {
      const query = new URLSearchParams();
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (options?.direction) query.set("direction", options.direction);
      if (typeof options?.from === "number") query.set("from", String(options.from));
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveMessagesResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/messages${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    searchSessionArchiveSession: (workspaceId: string, sessionId: string, queryText: string) => {
      const query = new URLSearchParams();
      query.set("q", queryText);
      return requestJson<SessionArchiveSessionSearchResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/search?${query.toString()}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveSessionUsage: (workspaceId: string, sessionId: string) =>
      requestJson<SessionArchiveSessionUsage>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/usage`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    renameSessionArchiveSession: (workspaceId: string, sessionId: string, name: string) =>
      requestJson<{ item: SessionArchiveSession }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/rename`,
        { token, hostToken, method: "PATCH", body: { name }, timeoutMs: timeouts.status },
      ),
    trashSessionArchiveSession: (workspaceId: string, sessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    restoreSessionArchiveSession: (workspaceId: string, sessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/restore`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.status },
      ),
    permanentlyDeleteSessionArchiveSession: (workspaceId: string, sessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/permanent`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    listSessionArchiveTrash: (workspaceId: string) =>
      requestJson<{ sessions: SessionArchiveSession[] }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/trash`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    emptySessionArchiveTrash: (workspaceId: string) =>
      requestJson<{ ok: boolean; deleted: number }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/trash`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    getSessionArchiveStarred: (workspaceId: string) =>
      requestJson<SessionArchiveStarredResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/starred`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    starSessionArchiveSession: (workspaceId: string, sessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/star`,
        { token, hostToken, method: "PUT", timeoutMs: timeouts.status },
      ),
    unstarSessionArchiveSession: (workspaceId: string, sessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/star`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    listSessionArchivePins: (workspaceId: string, sessionId?: string) =>
      requestJson<SessionArchivePinsResponse>(
        baseUrl,
        sessionId
          ? `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/pins`
          : `/workspace/${encodeURIComponent(workspaceId)}/session-archive/pins`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    pinSessionArchiveMessage: (workspaceId: string, sessionId: string, messageId: number, note?: string) =>
      requestJson<{ id: number }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(String(messageId))}/pin`,
        { token, hostToken, method: "POST", body: note ? { note } : {}, timeoutMs: timeouts.status },
      ),
    unpinSessionArchiveMessage: (workspaceId: string, sessionId: string, messageId: number) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(String(messageId))}/pin`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    openSessionArchiveSessionDirectory: (workspaceId: string, sessionId: string) =>
      requestJson<SessionArchiveOpenSessionResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/open`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.status },
      ),
    resumeSessionArchiveSession: (workspaceId: string, sessionId: string) =>
      requestJson<SessionArchiveResumeSessionResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/resume`,
        { token, hostToken, method: "POST", body: { command_only: true }, timeoutMs: timeouts.status },
      ),
    exportSessionArchiveSessionHtml: (workspaceId: string, sessionId: string) =>
      requestJson<SessionArchiveExportResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/export`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    exportSessionArchiveSessionMarkdown: (workspaceId: string, sessionId: string) =>
      requestJson<SessionArchiveExportResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/md`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    publishSessionArchiveSession: (workspaceId: string, sessionId: string) =>
      requestJson<SessionArchivePublishResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/${encodeURIComponent(sessionId)}/publish`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.status },
      ),
    getSessionArchiveUsageSummary: (workspaceId: string, options?: { from?: string; to?: string }) => {
      const query = new URLSearchParams();
      if (options?.from) query.set("from", options.from);
      if (options?.to) query.set("to", options.to);
      query.set("include_one_shot", "true");
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveUsageSummaryResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/usage/summary${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveUsageComparison: (workspaceId: string, currentCost: number, options?: { from?: string; to?: string }) => {
      const query = new URLSearchParams();
      query.set("current_cost", String(currentCost));
      if (options?.from) query.set("from", options.from);
      if (options?.to) query.set("to", options.to);
      query.set("include_one_shot", "true");
      return requestJson<SessionArchiveUsageComparison>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/usage/comparison?${query.toString()}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveTopUsageSessions: (workspaceId: string, options?: { from?: string; to?: string; limit?: number }) => {
      const query = new URLSearchParams();
      if (options?.from) query.set("from", options.from);
      if (options?.to) query.set("to", options.to);
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      query.set("include_one_shot", "true");
      return requestJson<SessionArchiveTopUsageSession[]>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/usage/top-sessions?${query.toString()}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveAnalyticsBatch: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsBatchResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/batch`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsSummary: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsSummary>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/summary`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsActivity: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsActivityResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/activity`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsHeatmap: (workspaceId: string, metric?: string) => {
      const query = new URLSearchParams();
      if (metric) query.set("metric", metric);
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveAnalyticsHeatmapResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/heatmap${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveAnalyticsProjects: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsProjectsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/projects`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsHourOfWeek: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsHourOfWeekResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/hour-of-week`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsSessions: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsSessionShapeResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/sessions`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsVelocity: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsVelocityResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/velocity`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsTools: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsToolsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/tools`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsSkills: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsSkillsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/skills`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsTopSessions: (workspaceId: string, options?: { metric?: string; limit?: number }) => {
      const query = new URLSearchParams();
      if (options?.metric) query.set("metric", options.metric);
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveAnalyticsTopSessionsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/top-sessions${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveAnalyticsSignals: (workspaceId: string) =>
      requestJson<SessionArchiveAnalyticsSignalsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/signals`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveAnalyticsSignalSessions: (workspaceId: string, options?: { signal?: string; limit?: number }) => {
      const query = new URLSearchParams();
      if (options?.signal) query.set("signal", options.signal);
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveAnalyticsSignalSessionsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/analytics/signal-sessions${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveActivityReport: (workspaceId: string, options?: { preset?: string; from?: string; to?: string; bucket?: string }) => {
      const query = new URLSearchParams();
      if (options?.preset) query.set("preset", options.preset);
      if (options?.from) query.set("from", options.from);
      if (options?.to) query.set("to", options.to);
      if (options?.bucket) query.set("bucket", options.bucket);
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveActivityReport>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/activity/report${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    getSessionArchiveTrendTerms: (workspaceId: string, terms: string[], options?: { from?: string; to?: string; granularity?: string }) => {
      const query = new URLSearchParams();
      for (const term of terms) query.append("term", term);
      if (options?.from) query.set("from", options.from);
      if (options?.to) query.set("to", options.to);
      if (options?.granularity) query.set("granularity", options.granularity);
      query.set("include_one_shot", "true");
      query.set("include_automated", "true");
      return requestJson<SessionArchiveTrendsTermsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/trends/terms?${query.toString()}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    listSessionArchiveInsights: (workspaceId: string) =>
      requestJson<SessionArchiveInsightsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/insights`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    generateSessionArchiveInsight: (workspaceId: string, input: SessionArchiveGenerateInsightRequest) =>
      requestText(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/insights/generate`,
        { token, hostToken, method: "POST", body: input, timeoutMs: timeouts.workspaceImport },
      ),
    deleteSessionArchiveInsight: (workspaceId: string, insightId: number) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/insights/${encodeURIComponent(String(insightId))}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    uploadSessionArchiveExport: (workspaceId: string, input: SessionArchiveUploadImportRequest) =>
      requestJson<SessionArchiveImportStats>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/upload`,
        { token, hostToken, method: "POST", body: input, timeoutMs: timeouts.workspaceImport },
      ),
    importSessionArchiveClaudeAi: (workspaceId: string, input: SessionArchiveUploadImportRequest) =>
      requestText(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/import/claude-ai`,
        { token, hostToken, method: "POST", body: input, timeoutMs: timeouts.workspaceImport },
      ),
    importSessionArchiveChatGpt: (workspaceId: string, input: SessionArchiveUploadImportRequest) =>
      requestText(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/import/chatgpt`,
        { token, hostToken, method: "POST", body: input, timeoutMs: timeouts.workspaceImport },
      ),
    getSessionArchiveConfig: (workspaceId: string) =>
      requestJson<SessionArchiveConfigSnapshot>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/config`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveBackendsStatus: (workspaceId: string) =>
      requestJson<SessionArchiveBackendsStatusResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/backends/status`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    getSessionArchiveLifecycleStatus: (workspaceId: string) =>
      requestJson<SessionArchiveLifecycleStatus>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/lifecycle/status`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    updateSessionArchiveConfig: (workspaceId: string, input: SessionArchiveConfigUpdate) =>
      requestJson<SessionArchiveConfigSnapshot>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/config`,
        { token, hostToken, method: "PUT", body: input, timeoutMs: timeouts.status },
      ),
    listSessionArchiveWorktreeMappings: (workspaceId: string) =>
      requestJson<SessionArchiveWorktreeMappingsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/settings/worktree-mappings`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      ),
    upsertSessionArchiveWorktreeMapping: (workspaceId: string, input: SessionArchiveWorktreeMappingInput) =>
      requestJson<SessionArchiveWorktreeMapping>(
        baseUrl,
        input.id
          ? `/workspace/${encodeURIComponent(workspaceId)}/session-archive/settings/worktree-mappings/${encodeURIComponent(input.id)}`
          : `/workspace/${encodeURIComponent(workspaceId)}/session-archive/settings/worktree-mappings`,
        { token, hostToken, method: input.id ? "PUT" : "POST", body: input, timeoutMs: timeouts.status },
      ),
    deleteSessionArchiveWorktreeMapping: (workspaceId: string, mappingId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/settings/worktree-mappings/${encodeURIComponent(mappingId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.status },
      ),
    applySessionArchiveWorktreeMappings: (workspaceId: string) =>
      requestJson<SessionArchiveApplyWorktreeMappingsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/settings/worktree-mappings/apply`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.status },
      ),
    scanSessionArchiveSecrets: (workspaceId: string) =>
      requestJson<SessionArchiveSecretScanSummary>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/secrets/scan`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.workspaceImport },
      ),
    listSessionArchiveSecrets: (workspaceId: string, options?: { confidence?: SessionArchiveSecretConfidence; limit?: number; cursor?: number }) => {
      const query = new URLSearchParams();
      if (options?.confidence) query.set("confidence", options.confidence);
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (typeof options?.cursor === "number") query.set("cursor", String(options.cursor));
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveSecretFindingsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/secrets${suffix}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    searchSessionArchive: (workspaceId: string, queryText: string, options?: { cursor?: number; limit?: number }) => {
      const query = new URLSearchParams();
      query.set("q", queryText);
      if (typeof options?.cursor === "number") query.set("cursor", String(options.cursor));
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      return requestJson<SessionArchiveSearchResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/search?${query.toString()}`,
        { token, hostToken, timeoutMs: timeouts.sessionRead },
      );
    },
    syncSessionArchive: (
      workspaceId: string,
      options?: { limit?: number; mode?: "incremental" | "resync" },
    ) => {
      const query = new URLSearchParams();
      if (typeof options?.limit === "number") query.set("limit", String(options.limit));
      if (options?.mode) query.set("mode", options.mode);
      const suffix = query.size ? `?${query.toString()}` : "";
      return requestJson<SessionArchiveSyncResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sync${suffix}`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.workspaceImport },
      );
    },
    getSessionArchiveSyncStatus: (workspaceId: string) =>
      requestJson<SessionArchiveSyncStatus>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/session-archive/sync/status`,
        { token, hostToken, timeoutMs: timeouts.status },
      ),
  };
}
