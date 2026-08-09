import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import {
  type SessionArchiveSyncProgress,
  type SessionArchiveSyncStats,
  sessionArchiveBulkStarRequestSchema,
  sessionArchiveConfigUpdateSchema,
  sessionArchivePinRequestSchema,
  sessionArchiveRenameSessionRequestSchema,
  sessionArchiveResumeSessionRequestSchema,
  sessionArchiveUploadImportRequestSchema,
  sessionArchiveWorktreeMappingInputSchema,
} from "@onmyagent/types/session-archive";
import { ApiError } from "../core/errors.js";
import type { SessionArchiveStore } from "../services/session-archive.js";
import { getSessionArchiveLifecycleStatus } from "../services/session-archive-lifecycle.js";
import {
  resolveSessionArchiveRuntimePaths,
  syncSessionArchive,
  type SessionArchiveRuntimePaths,
  type SessionArchiveSourceRoot,
} from "../services/session-archive-sync.js";
import {
  defaultSessionArchiveStorePool,
  withSessionArchiveStore,
} from "../services/session-archive-store-pool.js";
import { resolveArchiveSsePollMs } from "../services/archive-sse-policy.js";
import { notifyArchiveDbChanged } from "../services/archive-change-bus.js";
import {
  DEFAULT_SESSION_ARCHIVE_PERIODIC_MS,
  shouldRunPeriodicArchiveSync,
} from "../services/automation-schedule-policy.js";
import {
  persistentSessionArchiveEventsResponse,
  persistentSessionArchiveWatchResponse,
  sseEvent,
  sseResponse,
} from "./workspace-session-archive-sse.js";
import { registerWorkspaceSessionArchiveAnalyticsRoutes } from "./workspace-session-archive-analytics-routes.js";
import {
  ensureSession,
  objectBody,
  parseContentSearchMode,
  parseMessageDirection,
  parseOptionalBoolean,
  parseOptionalDateOnly,
  parseOptionalNonNegativeInteger,
  parseOptionalPositiveInteger,
  parseSearchSort,
  parseSecretConfidence,
  parseSessionListAutomation,
  parseSessionListTermination,
  parseSyncMode,
  readCsvQuery,
  readJsonBody,
  readNumericId,
  readSessionId,
  withArchiveStore,
  withWorkspaceArchiveStore,
} from "./workspace-session-archive-route-helpers.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import pkg from "../../package.json" with { type: "json" };

const SERVER_VERSION = pkg.version;

type SessionArchiveSyncJob = {
  status: "running" | "completed" | "failed";
  started_at: string;
  finished_at: string | null;
  progress: SessionArchiveSyncProgress | null;
  stats: SessionArchiveSyncStats | null;
  error: string | null;
  promise: Promise<SessionArchiveSyncStats>;
};

function scheduleSessionArchiveAutoSync(input: {
  workspace: WorkspaceInfo;
  paths: SessionArchiveRuntimePaths;
  sourceRoots?: SessionArchiveSourceRoot[];
  jobs: Map<string, SessionArchiveSyncJob>;
  syncArchive: typeof syncSessionArchive;
}): void {
  const jobKey = sessionArchiveSyncJobKey(input.workspace.id, input.paths.dbPath);
  const existing = input.jobs.get(jobKey);
  if (existing?.status === "running") return;
  if (existing?.finished_at) {
    const finishedAtMs = Date.parse(existing.finished_at);
    if (
      Number.isFinite(finishedAtMs) &&
      !shouldRunPeriodicArchiveSync(finishedAtMs, Date.now(), DEFAULT_SESSION_ARCHIVE_PERIODIC_MS)
    ) {
      return;
    }
  }
  const startedAt = new Date().toISOString();
  const job: SessionArchiveSyncJob = {
    status: "running",
    started_at: startedAt,
    finished_at: null,
    progress: null,
    stats: null,
    error: null,
    promise: Promise.resolve({ total_sessions: 0, synced: 0, skipped: 0, failed: 0 }),
  };
  job.promise = input.syncArchive({
    workspace: input.workspace,
    paths: input.paths,
    sourceRoots: input.sourceRoots,
    mode: "incremental",
    onProgress: (progress) => {
      job.progress = progress;
    },
  })
    .then((stats) => {
      job.status = "completed";
      job.finished_at = new Date().toISOString();
      job.stats = stats;
      notifyArchiveDbChanged(input.paths.dbPath);
      return stats;
    })
    .catch((error: unknown) => {
      job.status = "failed";
      job.finished_at = new Date().toISOString();
      job.error = error instanceof Error ? error.message : String(error);
      job.stats = { total_sessions: 0, synced: 0, skipped: 0, failed: 1, warnings: [job.error], aborted: true };
      return job.stats;
    });
  input.jobs.set(jobKey, job);
  void job.promise;
}

export function registerWorkspaceSessionArchiveRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  resolveArchivePaths?: (workspace: WorkspaceInfo) => SessionArchiveRuntimePaths;
  sourceRoots?: SessionArchiveSourceRoot[];
  syncArchive?: typeof syncSessionArchive;
}) {
  const { routes, config, resolveWorkspace, sourceRoots } = input;
  const resolveArchivePaths = input.resolveArchivePaths ?? ((workspace) => resolveSessionArchiveRuntimePaths({ workspace }));
  const syncArchive = input.syncArchive ?? syncSessionArchive;
  // Job state belongs to this server instance, not a restart-stale module singleton.
  const sessionArchiveSyncJobs = new Map<string, SessionArchiveSyncJob>();

  const withResolvedWorkspaceArchiveStore = async (
    ctx: RequestContext,
    callback: (store: SessionArchiveStore, workspace: WorkspaceInfo, dbPath: string) => Response | Promise<Response>,
  ): Promise<Response> => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const dbPath = resolveArchivePaths(workspace).dbPath;
    return withSessionArchiveStore({ dbPath }, async (store) => callback(store, workspace, dbPath));
  };

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const paths = resolveArchivePaths(workspace);
    scheduleSessionArchiveAutoSync({ workspace, paths, sourceRoots, jobs: sessionArchiveSyncJobs, syncArchive });
    return withSessionArchiveStore({ dbPath: paths.dbPath }, async (store) => {
      return systemJsonResponse(store.listSessions({
        cursor: ctx.url.searchParams.get("cursor")?.trim() || undefined,
        start: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("start"), "start"),
        limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
        search: ctx.url.searchParams.get("search")?.trim() || undefined,
        agent: ctx.url.searchParams.get("agent")?.trim() || undefined,
        project: ctx.url.searchParams.get("project")?.trim() || undefined,
        excludeProject: ctx.url.searchParams.get("exclude_project")?.trim() || undefined,
        machine: ctx.url.searchParams.get("machine")?.trim() || undefined,
        date: parseOptionalDateOnly(ctx.url.searchParams.get("date"), "date"),
        from: parseOptionalDateOnly(ctx.url.searchParams.get("from"), "from"),
        to: parseOptionalDateOnly(ctx.url.searchParams.get("to"), "to"),
        activeSince: ctx.url.searchParams.get("active_since")?.trim() || undefined,
        minMessages: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("min_messages"), "min_messages"),
        maxMessages: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("max_messages"), "max_messages"),
        minUserMessages: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("min_user_messages"), "min_user_messages"),
        includeOneShot: parseOptionalBoolean(ctx.url.searchParams.get("include_one_shot")),
        includeAutomated: parseOptionalBoolean(ctx.url.searchParams.get("include_automated")),
        automated: parseSessionListAutomation(ctx.url.searchParams.get("automated")),
        includeChildren: parseOptionalBoolean(ctx.url.searchParams.get("include_children")),
        includeOrphans: parseOptionalBoolean(ctx.url.searchParams.get("include_orphans")),
        outcome: readCsvQuery(ctx.url.searchParams, "outcome"),
        healthGrade: readCsvQuery(ctx.url.searchParams, "health_grade"),
        minToolFailures: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("min_tool_failures"), "min_tool_failures"),
        hasSecret: parseOptionalBoolean(ctx.url.searchParams.get("has_secret")),
        starred: parseOptionalBoolean(ctx.url.searchParams.get("starred")),
        termination: parseSessionListTermination(ctx.url.searchParams.get("termination")),
      }));
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId", "client", async (ctx) => {
    return withResolvedWorkspaceArchiveStore(ctx, (store) => {
      const session = store.getSession(readSessionId(ctx));
      if (!session) {
        throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      }
      return systemJsonResponse({ item: session });
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/messages", "client", async (ctx) => {
    return withResolvedWorkspaceArchiveStore(ctx, (store) => {
      const sessionId = readSessionId(ctx);
      if (!store.getSession(sessionId)) {
        throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      }
      return systemJsonResponse(store.listMessages(sessionId, {
        limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
        direction: parseMessageDirection(ctx.url.searchParams.get("direction")),
        from: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("from"), "from"),
      }));
    });
  });

  addRoute(routes, "PATCH", "/workspace/:id/session-archive/sessions/:sessionId/rename", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveRenameSessionRequestSchema.parse(await readJsonBody(ctx));
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const session = store.renameSession(sessionId, payload);
      if (!session) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse({ item: session });
    }, { notify: true });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/sessions/:sessionId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      if (!store.trashSession(sessionId)) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sessions/:sessionId/restore", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      if (!store.restoreSession(sessionId)) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/sessions/:sessionId/permanent", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      if (!store.permanentlyDeleteSession(sessionId)) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/trash", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.listTrash()));
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/trash", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => systemJsonResponse({ ok: true, deleted: store.emptyTrash() }),
      { notify: true },
    );
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/directory", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const directory = store.getSessionDirectory(sessionId);
      if (!directory) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(directory);
    });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sessions/:sessionId/open", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const opened = store.openSessionDirectory(sessionId);
      if (!opened) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(opened);
    });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sessions/:sessionId/resume", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveResumeSessionRequestSchema.parse(await readJsonBody(ctx, {}));
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const resumed = store.resumeSession(sessionId, payload);
      if (!resumed) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(resumed);
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/export", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const exported = store.exportSessionHtml(sessionId);
      if (!exported) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(exported);
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/md", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const exported = store.exportSessionMarkdown(sessionId);
      if (!exported) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(exported);
    });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sessions/:sessionId/publish", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const published = store.publishSession(sessionId);
      if (!published) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(published);
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/starred", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse({ session_ids: store.listStarredSessions() }));
  });

  addRoute(routes, "PUT", "/workspace/:id/session-archive/sessions/:sessionId/star", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      if (!store.starSession(sessionId)) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/sessions/:sessionId/star", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      store.unstarSession(sessionId);
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/starred/bulk", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveBulkStarRequestSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => {
      store.bulkStarSessions(payload.session_ids);
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/pins", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.listPins(ctx.url.searchParams.get("project") ?? undefined)));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/pins", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => systemJsonResponse(store.listSessionPins(sessionId)));
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sessions/:sessionId/messages/:messageId/pin", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchivePinRequestSchema.parse(await readJsonBody(ctx, {}));
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const pinned = store.pinMessage(sessionId, readNumericId(ctx.params.messageId, "messageId"), payload);
      if (!pinned) throw new ApiError(400, "session_archive_pin_failed", "message does not belong to this session");
      return systemJsonResponse(pinned, 201);
    }, { notify: true });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/sessions/:sessionId/messages/:messageId/pin", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      store.unpinMessage(sessionId, readNumericId(ctx.params.messageId, "messageId"));
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/tool-calls", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      ensureSession(store, sessionId);
      return systemJsonResponse(store.listToolCalls(sessionId));
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/children", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      ensureSession(store, sessionId);
      return systemJsonResponse(store.listChildren(sessionId));
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/activity", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const activity = store.getActivity(sessionId);
      if (!activity) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(activity);
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/timing", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const timing = store.getTiming(sessionId);
      if (!timing) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(timing);
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/search", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      ensureSession(store, sessionId);
      return systemJsonResponse(store.searchSession({
        sessionId,
        query: ctx.url.searchParams.get("q")?.trim() || "",
      }));
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/watch", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const dbPath = resolveArchivePaths(workspace).dbPath;
    const sessionId = readSessionId(ctx);
    const pollMs = resolveArchiveSsePollMs(
      parseOptionalPositiveInteger(ctx.url.searchParams.get("poll_ms"), "poll_ms"),
    );
    const maxEvents = parseOptionalPositiveInteger(ctx.url.searchParams.get("max_events"), "max_events") ?? 0;
    // Acquire for the SSE connection lifetime (released on abort/close).
    const store = await defaultSessionArchiveStorePool.acquire({ dbPath });
    const session = store.getSession(sessionId);
    const timing = store.getTiming(sessionId);
    if (!session || !timing) {
      defaultSessionArchiveStorePool.release({ dbPath });
      throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
    }
    return persistentSessionArchiveWatchResponse({
      store,
      dbPath,
      sessionId,
      session,
      timing,
      pollMs,
      maxEvents,
      signal: ctx.request.signal,
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/events", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const dbPath = resolveArchivePaths(workspace).dbPath;
    const pollMs = resolveArchiveSsePollMs(
      parseOptionalPositiveInteger(ctx.url.searchParams.get("poll_ms"), "poll_ms"),
    );
    const maxEvents = parseOptionalPositiveInteger(ctx.url.searchParams.get("max_events"), "max_events") ?? 0;
    const store = await defaultSessionArchiveStorePool.acquire({ dbPath });
    return persistentSessionArchiveEventsResponse({
      store,
      dbPath,
      workspaceId: workspace.id,
      stats: store.stats(),
      pollMs,
      maxEvents,
      signal: ctx.request.signal,
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/insights", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.listInsights({
      type: ctx.url.searchParams.get("type")?.trim() || undefined,
      project: ctx.url.searchParams.get("project")?.trim() || undefined,
      dateFrom: ctx.url.searchParams.get("date_from")?.trim() || undefined,
      dateTo: ctx.url.searchParams.get("date_to")?.trim() || undefined,
    })));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/insights/:insightId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => {
      const insight = store.getInsight(readNumericId(ctx.params.insightId, "insightId"));
      if (!insight) throw new ApiError(404, "session_archive_insight_not_found", "Session archive insight not found");
      return systemJsonResponse(insight);
    });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/insights/:insightId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => {
      const deleted = store.deleteInsight(readNumericId(ctx.params.insightId, "insightId"));
      if (!deleted) throw new ApiError(404, "session_archive_insight_not_found", "Session archive insight not found");
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/insights/generate", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = await ctx.request.json().catch(() => null);
    const dbPath = resolveArchivePaths(workspace).dbPath;
    return withSessionArchiveStore({ dbPath }, async (store) => {
      const insight = store.generateInsight(payload);
      notifyArchiveDbChanged(dbPath);
      return sseResponse([
        sseEvent("status", { phase: "generating" }),
        sseEvent("log", { stream: "stdout", line: "generated local archive insight" }),
        sseEvent("done", insight),
      ]);
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/search", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const query = ctx.url.searchParams.get("q")?.trim() || ctx.url.searchParams.get("query")?.trim() || "";
    if (!query) {
      throw new ApiError(400, "invalid_query", "q is required");
    }
    return withSessionArchiveStore({ dbPath: resolveArchivePaths(workspace).dbPath }, async (store) => {
      return systemJsonResponse(store.search({
        query,
        cursor: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("cursor"), "cursor"),
        limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
        sort: parseSearchSort(ctx.url.searchParams.get("sort")),
        project: ctx.url.searchParams.get("project")?.trim() || undefined,
        excludeProject: ctx.url.searchParams.get("exclude_project")?.trim() || undefined,
        machine: ctx.url.searchParams.get("machine")?.trim() || undefined,
        agent: ctx.url.searchParams.get("agent")?.trim() || undefined,
        date: parseOptionalDateOnly(ctx.url.searchParams.get("date"), "date"),
        from: parseOptionalDateOnly(ctx.url.searchParams.get("from"), "from"),
        to: parseOptionalDateOnly(ctx.url.searchParams.get("to"), "to"),
        activeSince: ctx.url.searchParams.get("active_since")?.trim() || undefined,
        minMessages: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("min_messages"), "min_messages"),
        maxMessages: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("max_messages"), "max_messages"),
        minUserMessages: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("min_user_messages"), "min_user_messages"),
        includeOneShot: parseOptionalBoolean(ctx.url.searchParams.get("include_one_shot")),
        includeAutomated: parseOptionalBoolean(ctx.url.searchParams.get("include_automated")),
        automated: parseSessionListAutomation(ctx.url.searchParams.get("automated")),
        includeChildren: parseOptionalBoolean(ctx.url.searchParams.get("include_children")),
        includeOrphans: parseOptionalBoolean(ctx.url.searchParams.get("include_orphans")),
        outcome: readCsvQuery(ctx.url.searchParams, "outcome"),
        healthGrade: readCsvQuery(ctx.url.searchParams, "health_grade"),
        minToolFailures: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("min_tool_failures"), "min_tool_failures"),
        hasSecret: parseOptionalBoolean(ctx.url.searchParams.get("has_secret")),
        starred: parseOptionalBoolean(ctx.url.searchParams.get("starred")),
        termination: parseSessionListTermination(ctx.url.searchParams.get("termination")),
      }));
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/search/content", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const pattern = ctx.url.searchParams.get("pattern")?.trim() || "";
    if (!pattern) {
      throw new ApiError(400, "invalid_query", "pattern is required");
    }
    return withSessionArchiveStore({ dbPath: resolveArchivePaths(workspace).dbPath }, async (store) => {
      return systemJsonResponse(store.searchContent({
        pattern,
        mode: parseContentSearchMode(ctx.url.searchParams.get("mode")),
        sources: ctx.url.searchParams.get("in")?.split(",").map((item) => item.trim()).filter(Boolean),
        excludeSystem: ctx.url.searchParams.get("exclude_system") === "true",
        cursor: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("cursor"), "cursor"),
        limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
        project: ctx.url.searchParams.get("project")?.trim() || undefined,
        agent: ctx.url.searchParams.get("agent")?.trim() || undefined,
      }));
    });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sessions/upload", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveUploadImportRequestSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => systemJsonResponse(store.importUploadedExport(payload)),
      { notify: true },
    );
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/import/claude-ai", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveUploadImportRequestSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => sseResponse([
        sseEvent("progress", { imported: 0, updated: 0, skipped: 0, errors: 0 }),
        sseEvent("done", store.importClaudeAiExport(payload)),
      ]),
      { notify: true },
    );
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/import/chatgpt", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveUploadImportRequestSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => sseResponse([
        sseEvent("progress", { imported: 0, updated: 0, skipped: 0, errors: 0 }),
        sseEvent("done", store.importChatGptExport(payload)),
      ]),
      { notify: true },
    );
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/config", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getConfigSnapshot()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/backends/status", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getBackendsStatus()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/lifecycle/status", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const paths = resolveArchivePaths(workspace);
    return systemJsonResponse(await getSessionArchiveLifecycleStatus({ paths, startedAt: config.startedAt, version: SERVER_VERSION }));
  });

  addRoute(routes, "PUT", "/workspace/:id/session-archive/config", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveConfigUpdateSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => systemJsonResponse(store.updateConfig(payload)),
      { notify: true },
    );
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/settings/worktree-mappings", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse({ mappings: store.getConfigSnapshot().worktree_mappings }));
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/settings/worktree-mappings", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveWorktreeMappingInputSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => systemJsonResponse(store.upsertWorktreeMapping(payload), 201),
      { notify: true },
    );
  });

  addRoute(routes, "PUT", "/workspace/:id/session-archive/settings/worktree-mappings/:mappingId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveWorktreeMappingInputSchema.parse({ ...objectBody(await readJsonBody(ctx)), id: ctx.params.mappingId });
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => systemJsonResponse(store.upsertWorktreeMapping(payload)),
      { notify: true },
    );
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/settings/worktree-mappings/:mappingId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => {
      if (!store.deleteWorktreeMapping(ctx.params.mappingId ?? "")) throw new ApiError(404, "session_archive_mapping_not_found", "Session archive worktree mapping not found");
      return systemJsonResponse({ ok: true });
    }, { notify: true });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/settings/worktree-mappings/apply", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => systemJsonResponse(store.applyWorktreeMappings()),
      { notify: true },
    );
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/secrets", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.listSecretFindings({
      project: ctx.url.searchParams.get("project")?.trim() || undefined,
      agent: ctx.url.searchParams.get("agent")?.trim() || undefined,
      from: ctx.url.searchParams.get("from")?.trim() || undefined,
      to: ctx.url.searchParams.get("to")?.trim() || undefined,
      rule: ctx.url.searchParams.get("rule")?.trim() || undefined,
      confidence: parseSecretConfidence(ctx.url.searchParams.get("confidence")),
      cursor: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("cursor"), "cursor"),
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    })));
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/secrets/scan", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(
      resolveArchivePaths(workspace).dbPath,
      (store) => systemJsonResponse(store.scanSecrets()),
      { notify: true },
    );
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sync", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const paths = resolveArchivePaths(workspace);
    const jobKey = sessionArchiveSyncJobKey(workspace.id, paths.dbPath);
    const existing = sessionArchiveSyncJobs.get(jobKey);
    if (existing?.status === "running") {
      return systemJsonResponse(syncJobResponse(existing, paths.dbPath));
    }
    const startedAt = new Date().toISOString();
    const job: SessionArchiveSyncJob = {
      status: "running",
      started_at: startedAt,
      finished_at: null,
      progress: null,
      stats: null,
      error: null,
      promise: Promise.resolve({ total_sessions: 0, synced: 0, skipped: 0, failed: 0 }),
    };
    job.promise = syncArchive({
      workspace,
      paths,
      sourceRoots,
      mode: parseSyncMode(ctx.url.searchParams.get("mode")),
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
      onProgress: (progress) => {
        job.progress = progress;
      },
    })
      .then((stats) => {
        job.status = "completed";
        job.finished_at = new Date().toISOString();
        job.stats = stats;
        // Explicit POST /sync must wake SSE the same way auto-sync does.
        notifyArchiveDbChanged(paths.dbPath);
        return stats;
      })
      .catch((error: unknown) => {
        job.status = "failed";
        job.finished_at = new Date().toISOString();
        job.error = error instanceof Error ? error.message : String(error);
        job.stats = { total_sessions: 0, synced: 0, skipped: 0, failed: 1, warnings: [job.error], aborted: true };
        return job.stats;
      });
    sessionArchiveSyncJobs.set(jobKey, job);
    void job.promise;
    return systemJsonResponse(syncJobResponse(job, paths.dbPath), 202);
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/sync/status", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const paths = resolveArchivePaths(workspace);
    const job = sessionArchiveSyncJobs.get(sessionArchiveSyncJobKey(workspace.id, paths.dbPath));
    if (job?.status === "running") {
      return systemJsonResponse(syncJobResponse(job, paths.dbPath));
    }
    if (job?.stats) {
      return systemJsonResponse(syncJobResponse(job, paths.dbPath));
    }
    return withSessionArchiveStore({ dbPath: paths.dbPath }, async (store) => {
      return systemJsonResponse({ ok: true, status: "idle", stats: store.stats(), dbPath: paths.dbPath });
    });
  });

  registerWorkspaceSessionArchiveAnalyticsRoutes({
    routes,
    config,
    resolveWorkspace,
    resolveArchivePaths,
  });
}

function sessionArchiveSyncJobKey(workspaceId: string, dbPath: string): string {
  return `${workspaceId}:${dbPath}`;
}

function syncJobResponse(job: SessionArchiveSyncJob, dbPath: string) {
  return {
    ok: job.status !== "failed",
    status: job.status,
    started_at: job.started_at,
    finished_at: job.finished_at,
    last_sync: job.finished_at,
    progress: job.progress,
    stats: job.stats,
    error: job.error,
    dbPath,
  };
}
