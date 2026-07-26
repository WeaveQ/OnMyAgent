import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import type { SessionArchiveStore } from "../services/session-archive.js";
import {
  withSessionArchiveStore,
} from "../services/session-archive-store-pool.js";
import type { SessionArchiveRuntimePaths } from "../services/session-archive-sync.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import {
  parseActivityAutomation,
  parseActivityBucket,
  parseActivityPreset,
  parseOptionalPositiveInteger,
  parseRequiredNumber,
  parseTrendGranularity,
  parseUsageFilter,
  withArchiveStore,
  withWorkspaceArchiveStore,
} from "./workspace-session-archive-route-helpers.js";

export function registerWorkspaceSessionArchiveAnalyticsRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  resolveArchivePaths: (workspace: WorkspaceInfo) => SessionArchiveRuntimePaths;
}) {
  const { routes, config, resolveWorkspace, resolveArchivePaths } = input;

  const withResolvedWorkspaceArchiveStore = async (
    ctx: RequestContext,
    callback: (store: SessionArchiveStore, workspace: WorkspaceInfo, dbPath: string) => Response | Promise<Response>,
  ): Promise<Response> => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const dbPath = resolveArchivePaths(workspace).dbPath;
    return withSessionArchiveStore({ dbPath }, async (store) => callback(store, workspace, dbPath));
  };

  addRoute(routes, "GET", "/workspace/:id/session-archive/sessions/:sessionId/usage", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return withArchiveStore(resolveArchivePaths(workspace).dbPath, ctx, (store, sessionId) => {
      const usage = store.getUsage(sessionId);
      if (!usage) throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
      return systemJsonResponse(usage);
    });
  });

  addRoute(routes, "GET", "/workspace/:id/session-archive/usage/summary", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filter = parseUsageFilter(ctx);
    return withSessionArchiveStore({ dbPath: resolveArchivePaths(workspace).dbPath }, async (store) => {
      return systemJsonResponse(store.getUsageSummary(filter));
    });
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
}
