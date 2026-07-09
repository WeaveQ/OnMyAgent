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
import { openSessionArchiveStore } from "../services/session-archive.js";
import { getSessionArchiveLifecycleStatus } from "../services/session-archive-lifecycle.js";
import {
  resolveSessionArchiveRuntimePaths,
  syncSessionArchive,
  type SessionArchiveRuntimePaths,
  type SessionArchiveSourceRoot,
  type SessionArchiveSyncMode,
} from "../services/session-archive-sync.js";
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

const sessionArchiveSyncJobs = new Map<string, SessionArchiveSyncJob>();

const SESSION_ARCHIVE_AUTO_SYNC_INTERVAL_MS = 5_000;

function scheduleSessionArchiveAutoSync(input: {
  workspace: WorkspaceInfo;
  paths: SessionArchiveRuntimePaths;
  sourceRoots?: SessionArchiveSourceRoot[];
}): void {
  const jobKey = sessionArchiveSyncJobKey(input.workspace.id, input.paths.dbPath);
  const existing = sessionArchiveSyncJobs.get(jobKey);
  if (existing?.status === "running") return;
  if (existing?.finished_at) {
    const finishedAtMs = Date.parse(existing.finished_at);
    if (Number.isFinite(finishedAtMs) && Date.now() - finishedAtMs < SESSION_ARCHIVE_AUTO_SYNC_INTERVAL_MS) {
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
  job.promise = syncSessionArchive({
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
}


export function registerWorkspaceSessionArchiveRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  resolveArchivePaths?: (workspace: WorkspaceInfo) => SessionArchiveRuntimePaths;
  sourceRoots?: SessionArchiveSourceRoot[];
}) {
  const {
    routes,
    config,
    resolveWorkspace,
    resolveArchivePaths = (workspace) => resolveSessionArchiveRuntimePaths({ workspace }),
    sourceRoots,
  } = input;

  const withResolvedWorkspaceArchiveStore = async (
    ctx: RequestContext,
    callback: (store: SessionArchiveStore, workspace: WorkspaceInfo, dbPath: string) => Response,
  ): Promise<Response> => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const dbPath = resolveArchivePaths(workspace).dbPath;
    const store = await openSessionArchiveStore({ dbPath });
    try {
      return callback(store, workspace, dbPath);
    } finally {
      store.close();
    }
  };

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const paths = resolveArchivePaths(workspace);
    scheduleSessionArchiveAutoSync({ workspace, paths, sourceRoots });
    const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
    try {
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
    } finally {
      store.close();
    }
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
    });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/sessions/:sessionId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      if (!store.trashSession(sessionId)) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse({ ok: true });
    });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sessions/:sessionId/restore", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      if (!store.restoreSession(sessionId)) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse({ ok: true });
    });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/sessions/:sessionId/permanent", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      if (!store.permanentlyDeleteSession(sessionId)) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse({ ok: true });
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/trash", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.listTrash()));
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/trash", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse({ ok: true, deleted: store.emptyTrash() }));
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
    });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/sessions/:sessionId/star", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      store.unstarSession(sessionId);
      return systemJsonResponse({ ok: true });
    });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/starred/bulk", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveBulkStarRequestSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => {
      store.bulkStarSessions(payload.session_ids);
      return systemJsonResponse({ ok: true });
    });
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
    });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/sessions/:sessionId/messages/:messageId/pin", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      store.unpinMessage(sessionId, readNumericId(ctx.params.messageId, "messageId"));
      return systemJsonResponse({ ok: true });
    });
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

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/usage", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const usage = store.getUsage(sessionId);
      if (!usage) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(usage);
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
    const pollMs = parseOptionalPositiveInteger(ctx.url.searchParams.get("poll_ms"), "poll_ms") ?? 1500;
    const maxEvents = parseOptionalPositiveInteger(ctx.url.searchParams.get("max_events"), "max_events") ?? 0;
    const store = await openSessionArchiveStore({ dbPath });
    try {
      const session = store.getSession(sessionId);
      const timing = store.getTiming(sessionId);
      if (!session || !timing) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return persistentSessionArchiveWatchResponse({ dbPath, sessionId, session, timing, pollMs, maxEvents, signal: ctx.request.signal });
    } finally {
      store.close();
    }
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/events", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const dbPath = resolveArchivePaths(workspace).dbPath;
    const pollMs = parseOptionalPositiveInteger(ctx.url.searchParams.get("poll_ms"), "poll_ms") ?? 2500;
    const maxEvents = parseOptionalPositiveInteger(ctx.url.searchParams.get("max_events"), "max_events") ?? 0;
    const store = await openSessionArchiveStore({ dbPath });
    try {
      return persistentSessionArchiveEventsResponse({ dbPath, workspaceId: workspace.id, stats: store.stats(), pollMs, maxEvents, signal: ctx.request.signal });
    } finally {
      store.close();
    }
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/usage/summary", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filter = parseUsageFilter(ctx);
    const store = await openSessionArchiveStore({ dbPath: resolveArchivePaths(workspace).dbPath });
    try {
      return systemJsonResponse(store.getUsageSummary(filter));
    } finally {
      store.close();
    }
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/usage/comparison", "client", async (ctx) => {
    const currentCost = parseRequiredNumber(ctx.url.searchParams.get("current_cost"), "current_cost");
    return withResolvedWorkspaceArchiveStore(ctx, (store) => {
      return systemJsonResponse(store.getUsageComparison({
        ...parseUsageFilter(ctx),
        currentCost,
      }));
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/usage/top-sessions", "client", async (ctx) => {
    return withResolvedWorkspaceArchiveStore(ctx, (store) => {
      return systemJsonResponse(store.getTopUsageSessions({
        ...parseUsageFilter(ctx),
        limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
      }));
    });
  });

  // Batch analytics endpoint: single request for all analytics data
  // Reduces 13 HTTP requests to 1, leverages analytics cache for maximum performance
  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/batch", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsBatch()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/summary", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsSummary()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/activity", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsActivity()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/heatmap", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const metric = ctx.url.searchParams.get("metric")?.trim() || undefined;
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsHeatmap(metric)));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/projects", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsProjects()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/hour-of-week", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsHourOfWeek()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsSessionShape()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/velocity", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsVelocity()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/tools", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsTools()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/skills", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsSkills()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/top-sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const metric = ctx.url.searchParams.get("metric")?.trim() || undefined;
    const limit = parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit");
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsTopSessions(metric, limit)));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/signals", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsSignals()));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/analytics/signal-sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const signal = ctx.url.searchParams.get("signal")?.trim() || "low_health";
    const limit = parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit");
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getAnalyticsSignalSessions(signal, limit)));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/activity/report", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getActivityReport({
      preset: parseActivityPreset(ctx.url.searchParams.get("preset")),
      date: ctx.url.searchParams.get("date")?.trim() || undefined,
      from: ctx.url.searchParams.get("from")?.trim() || undefined,
      to: ctx.url.searchParams.get("to")?.trim() || undefined,
      timezone: ctx.url.searchParams.get("timezone")?.trim() || undefined,
      bucket: parseActivityBucket(ctx.url.searchParams.get("bucket")),
      project: ctx.url.searchParams.get("project")?.trim() || undefined,
      agent: ctx.url.searchParams.get("agent")?.trim() || undefined,
      machine: ctx.url.searchParams.get("machine")?.trim() || undefined,
      automation: parseActivityAutomation(ctx.url.searchParams.get("automation")),
    })));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/trends/terms", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const terms = ctx.url.searchParams.getAll("term").map((term) => term.trim()).filter(Boolean);
    if (terms.length === 0) {
      throw new ApiError(400, "invalid_query", "at least one term is required");
    }
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.getTrendsTerms({
      ...parseUsageFilter(ctx),
      terms,
      granularity: parseTrendGranularity(ctx.url.searchParams.get("granularity")),
    })));
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
    });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/insights/generate", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = await ctx.request.json().catch(() => null);
    const store = await openSessionArchiveStore({ dbPath: resolveArchivePaths(workspace).dbPath });
    try {
      const insight = store.generateInsight(payload);
      return sseResponse([
        sseEvent("status", { phase: "generating" }),
        sseEvent("log", { stream: "stdout", line: "generated local archive insight" }),
        sseEvent("done", insight),
      ]);
    } finally {
      store.close();
    }
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/search", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const query = ctx.url.searchParams.get("q")?.trim() || ctx.url.searchParams.get("query")?.trim() || "";
    if (!query) {
      throw new ApiError(400, "invalid_query", "q is required");
    }
    const store = await openSessionArchiveStore({ dbPath: resolveArchivePaths(workspace).dbPath });
    try {
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
    } finally {
      store.close();
    }
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/search/content", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const pattern = ctx.url.searchParams.get("pattern")?.trim() || "";
    if (!pattern) {
      throw new ApiError(400, "invalid_query", "pattern is required");
    }
    const store = await openSessionArchiveStore({ dbPath: resolveArchivePaths(workspace).dbPath });
    try {
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
    } finally {
      store.close();
    }
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/sessions/upload", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveUploadImportRequestSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.importUploadedExport(payload)));
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/import/claude-ai", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveUploadImportRequestSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => sseResponse([
      sseEvent("progress", { imported: 0, updated: 0, skipped: 0, errors: 0 }),
      sseEvent("done", store.importClaudeAiExport(payload)),
    ]));
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/import/chatgpt", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveUploadImportRequestSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => sseResponse([
      sseEvent("progress", { imported: 0, updated: 0, skipped: 0, errors: 0 }),
      sseEvent("done", store.importChatGptExport(payload)),
    ]));
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
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.updateConfig(payload)));
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/settings/worktree-mappings", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse({ mappings: store.getConfigSnapshot().worktree_mappings }));
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/settings/worktree-mappings", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveWorktreeMappingInputSchema.parse(await readJsonBody(ctx));
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.upsertWorktreeMapping(payload), 201));
  });

  addRoute(routes, "PUT", "/workspace/:id/session-archive/settings/worktree-mappings/:mappingId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const payload = sessionArchiveWorktreeMappingInputSchema.parse({ ...objectBody(await readJsonBody(ctx)), id: ctx.params.mappingId });
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.upsertWorktreeMapping(payload)));
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-archive/settings/worktree-mappings/:mappingId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => {
      if (!store.deleteWorktreeMapping(ctx.params.mappingId ?? "")) throw new ApiError(404, "session_archive_mapping_not_found", "Session archive worktree mapping not found");
      return systemJsonResponse({ ok: true });
    });
  });

  addRoute(routes, "POST", "/workspace/:id/session-archive/settings/worktree-mappings/apply", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.applyWorktreeMappings()));
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
    return withWorkspaceArchiveStore(resolveArchivePaths(workspace).dbPath, (store) => systemJsonResponse(store.scanSecrets()));
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
    job.promise = syncSessionArchive({
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
    const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
    try {
      return systemJsonResponse({ ok: true, status: "idle", stats: store.stats(), dbPath: paths.dbPath });
    } finally {
      store.close();
    }
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

async function withArchiveStore(
  dbPath: string,
  ctx: RequestContext,
  callback: (store: SessionArchiveStore, sessionId: string) => Response,
): Promise<Response> {
  const store = await openSessionArchiveStore({ dbPath });
  try {
    return callback(store, readSessionId(ctx));
  } finally {
    store.close();
  }
}

async function withWorkspaceArchiveStore(
  dbPath: string,
  callback: (store: SessionArchiveStore) => Response,
): Promise<Response> {
  const store = await openSessionArchiveStore({ dbPath });
  try {
    return callback(store);
  } finally {
    store.close();
  }
}

function ensureSession(store: SessionArchiveStore, sessionId: string) {
  if (!store.getSession(sessionId)) {
    throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
  }
}

function readSessionId(ctx: RequestContext): string {
  const sessionId = (ctx.params.sessionId ?? "").trim();
  if (!sessionId) {
    throw new ApiError(400, "invalid_payload", "sessionId is required");
  }
  return sessionId;
}

function parseOptionalPositiveInteger(value: string | null, name: string): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, "invalid_query", `${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(value: string | null, name: string): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(400, "invalid_query", `${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalDateOnly(value: string | null, name: string): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (!isDateOnly(trimmed)) {
    throw new ApiError(400, "invalid_query", `${name} must use YYYY-MM-DD`);
  }
  return trimmed;
}

function readCsvQuery(searchParams: URLSearchParams, name: string): string[] | undefined {
  const values = searchParams.getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function parseSessionListAutomation(value: string | null): "all" | "human" | "automated" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "all" || value === "human" || value === "automated") return value;
  throw new ApiError(400, "invalid_query", "automated must be all, human, or automated");
}

function parseSessionListTermination(value: string | null): "all" | "clean" | "unclean" | "truncated" | "tool_call_pending" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "all" || value === "clean" || value === "unclean" || value === "truncated" || value === "tool_call_pending") return value;
  throw new ApiError(400, "invalid_query", "termination must be all, clean, unclean, truncated, or tool_call_pending");
}

function parseRequiredNumber(value: string | null, name: string): number {
  if (value == null || value.trim() === "") {
    throw new ApiError(400, "invalid_query", `${name} is required`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, "invalid_query", `${name} must be a number`);
  }
  return parsed;
}

function parseUsageFilter(ctx: RequestContext) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDefault = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const from = ctx.url.searchParams.get("from")?.trim() || fromDefault;
  const to = ctx.url.searchParams.get("to")?.trim() || today;
  if (!isDateOnly(from) || !isDateOnly(to)) {
    throw new ApiError(400, "invalid_query", "from and to must use YYYY-MM-DD");
  }
  if (from > to) {
    throw new ApiError(400, "invalid_query", "from must not be after to");
  }
  return {
    from,
    to,
    agent: ctx.url.searchParams.get("agent")?.trim() || undefined,
    project: ctx.url.searchParams.get("project")?.trim() || undefined,
    machine: ctx.url.searchParams.get("machine")?.trim() || undefined,
    model: ctx.url.searchParams.get("model")?.trim() || undefined,
    excludeProject: ctx.url.searchParams.get("exclude_project")?.trim() || undefined,
    excludeAgent: ctx.url.searchParams.get("exclude_agent")?.trim() || undefined,
    excludeModel: ctx.url.searchParams.get("exclude_model")?.trim() || undefined,
    minUserMessages: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("min_user_messages"), "min_user_messages"),
    includeOneShot: parseOptionalBoolean(ctx.url.searchParams.get("include_one_shot")) ?? true,
    includeAutomated: parseOptionalBoolean(ctx.url.searchParams.get("include_automated")) ?? false,
    activeSince: ctx.url.searchParams.get("active_since")?.trim() || undefined,
  };
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiError(400, "invalid_query", "boolean query values must be true or false");
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());
}

function parseSyncMode(value: string | null): SessionArchiveSyncMode | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "incremental" || value === "resync") return value;
  throw new ApiError(400, "invalid_query", "mode must be incremental or resync");
}

function parseMessageDirection(value: string | null): "asc" | "desc" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "asc" || value === "desc") return value;
  throw new ApiError(400, "invalid_query", "direction must be asc or desc");
}

function parseSearchSort(value: string | null): "relevance" | "recency" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "relevance" || value === "recency") return value;
  throw new ApiError(400, "invalid_query", "sort must be relevance or recency");
}

function parseContentSearchMode(value: string | null): "substring" | "regex" | "fts" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "substring" || value === "regex" || value === "fts") return value;
  throw new ApiError(400, "invalid_query", "mode must be substring, regex, or fts");
}

function parseActivityPreset(value: string | null): "day" | "week" | "month" | "custom" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "day" || value === "week" || value === "month" || value === "custom") return value;
  throw new ApiError(400, "invalid_query", "preset must be day, week, month, or custom");
}

function parseActivityBucket(value: string | null): "5m" | "15m" | "1h" | "1d" | "1w" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "5m" || value === "15m" || value === "1h" || value === "1d" || value === "1w") return value;
  throw new ApiError(400, "invalid_query", "bucket must be 5m, 15m, 1h, 1d, or 1w");
}

function parseActivityAutomation(value: string | null): "all" | "interactive" | "automated" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "all" || value === "interactive" || value === "automated") return value;
  throw new ApiError(400, "invalid_query", "automation must be all, interactive, or automated");
}

function parseTrendGranularity(value: string | null): "day" | "week" | "month" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "day" || value === "week" || value === "month") return value;
  throw new ApiError(400, "invalid_query", "granularity must be day, week, or month");
}

function parseSecretConfidence(value: string | null): "definite" | "candidate" | "all" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "definite" || value === "candidate" || value === "all") return value;
  throw new ApiError(400, "invalid_query", "confidence must be definite, candidate, or all");
}

function readNumericId(value: string | undefined, name: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(400, "invalid_payload", `${name} must be a non-negative integer`);
  }
  return parsed;
}

async function readJsonBody(ctx: RequestContext, fallback?: Record<string, unknown>): Promise<unknown> {
  try {
    return await ctx.request.json();
  } catch {
    if (fallback !== undefined) return fallback;
    throw new ApiError(400, "invalid_payload", "request body must be valid JSON");
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

function sseEvent(event: string, data: unknown): string {
  const value = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${value}\n\n`;
}

function sseResponse(events: string[]): Response {
  return new Response(events.join(""), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

function persistentSessionArchiveWatchResponse(input: {
  dbPath: string;
  sessionId: string;
  session: unknown;
  timing: unknown;
  pollMs: number;
  maxEvents: number;
  signal: AbortSignal;
}): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  let lastVersion = JSON.stringify({ session: input.session, timing: input.timing });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let timer: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseEvent(event, data)));
        sent += 1;
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        controller.close();
      };
      const closeIfDone = () => {
        if (input.maxEvents > 0 && sent >= input.maxEvents) {
          close();
          return true;
        }
        return false;
      };
      send("session.timing", input.timing);
      send("heartbeat", new Date().toISOString());
      if (closeIfDone()) return;
      timer = setInterval(async () => {
        if (input.signal.aborted) {
          close();
          return;
        }
        const store = await openSessionArchiveStore({ dbPath: input.dbPath });
        try {
          const session = store.getSession(input.sessionId);
          const timing = store.getTiming(input.sessionId);
          const version = JSON.stringify({ session, timing });
          if (session && timing && version !== lastVersion) {
            lastVersion = version;
            send("session.timing", timing);
            send("session_updated", { session_id: input.sessionId, session });
          } else {
            send("heartbeat", new Date().toISOString());
          }
          closeIfDone();
        } finally {
          store.close();
        }
      }, input.pollMs);
      input.signal.addEventListener("abort", () => {
        close();
      }, { once: true });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

function persistentSessionArchiveEventsResponse(input: {
  dbPath: string;
  workspaceId: string;
  stats: unknown;
  pollMs: number;
  maxEvents: number;
  signal: AbortSignal;
}): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  let lastVersion = JSON.stringify(input.stats);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let timer: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseEvent(event, data)));
        sent += 1;
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        controller.close();
      };
      const closeIfDone = () => {
        if (input.maxEvents > 0 && sent >= input.maxEvents) {
          close();
          return true;
        }
        return false;
      };
      send("data_changed", { scope: "session-archive.archive", workspace_id: input.workspaceId, stats: input.stats });
      send("heartbeat", new Date().toISOString());
      if (closeIfDone()) return;
      timer = setInterval(async () => {
        if (input.signal.aborted) {
          close();
          return;
        }
        const store = await openSessionArchiveStore({ dbPath: input.dbPath });
        try {
          const stats = store.stats();
          const version = JSON.stringify(stats);
          if (version !== lastVersion) {
            lastVersion = version;
            send("data_changed", { scope: "session-archive.archive", workspace_id: input.workspaceId, stats });
          } else {
            send("heartbeat", new Date().toISOString());
          }
          closeIfDone();
        } finally {
          store.close();
        }
      }, input.pollMs);
      input.signal.addEventListener("abort", () => {
        close();
      }, { once: true });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
