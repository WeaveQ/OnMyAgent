import { ApiError } from "../core/errors.js";
import type { SessionArchiveStore } from "../services/session-archive.js";
import {
  withSessionArchiveStore,
} from "../services/session-archive-store-pool.js";
import { notifyArchiveDbChanged } from "../services/archive-change-bus.js";
import type { SessionArchiveSyncMode } from "../services/session-archive-sync.js";
import { type RequestContext } from "./route-core.js";

export function ensureSession(store: SessionArchiveStore, sessionId: string) {
  if (!store.getSession(sessionId)) {
    throw new ApiError(404, "session_archive_session_not_found", "Session archive session not found");
  }
}

export function readSessionId(ctx: RequestContext): string {
  const sessionId = (ctx.params.sessionId ?? "").trim();
  if (!sessionId) {
    throw new ApiError(400, "invalid_payload", "sessionId is required");
  }
  return sessionId;
}

export function parseOptionalPositiveInteger(value: string | null, name: string): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, "invalid_query", `${name} must be a positive integer`);
  }
  return parsed;
}

export function parseOptionalNonNegativeInteger(value: string | null, name: string): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(400, "invalid_query", `${name} must be a non-negative integer`);
  }
  return parsed;
}

export function parseOptionalDateOnly(value: string | null, name: string): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (!isDateOnly(trimmed)) {
    throw new ApiError(400, "invalid_query", `${name} must use YYYY-MM-DD`);
  }
  return trimmed;
}

export function readCsvQuery(searchParams: URLSearchParams, name: string): string[] | undefined {
  const values = searchParams.getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

export function parseSessionListAutomation(value: string | null): "all" | "human" | "automated" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "all" || value === "human" || value === "automated") return value;
  throw new ApiError(400, "invalid_query", "automated must be all, human, or automated");
}

export function parseSessionListTermination(value: string | null): "all" | "clean" | "unclean" | "truncated" | "tool_call_pending" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "all" || value === "clean" || value === "unclean" || value === "truncated" || value === "tool_call_pending") return value;
  throw new ApiError(400, "invalid_query", "termination must be all, clean, unclean, truncated, or tool_call_pending");
}

export function parseRequiredNumber(value: string | null, name: string): number {
  if (value == null || value.trim() === "") {
    throw new ApiError(400, "invalid_query", `${name} is required`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, "invalid_query", `${name} must be a number`);
  }
  return parsed;
}

export function parseUsageFilter(ctx: RequestContext) {
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

export function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiError(400, "invalid_query", "boolean query values must be true or false");
}

export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());
}

export function parseSyncMode(value: string | null): SessionArchiveSyncMode | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "incremental" || value === "resync") return value;
  throw new ApiError(400, "invalid_query", "mode must be incremental or resync");
}

export function parseMessageDirection(value: string | null): "asc" | "desc" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "asc" || value === "desc") return value;
  throw new ApiError(400, "invalid_query", "direction must be asc or desc");
}

export function parseSearchSort(value: string | null): "relevance" | "recency" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "relevance" || value === "recency") return value;
  throw new ApiError(400, "invalid_query", "sort must be relevance or recency");
}

export function parseContentSearchMode(value: string | null): "substring" | "regex" | "fts" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "substring" || value === "regex" || value === "fts") return value;
  throw new ApiError(400, "invalid_query", "mode must be substring, regex, or fts");
}

export function parseActivityPreset(value: string | null): "day" | "week" | "month" | "custom" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "day" || value === "week" || value === "month" || value === "custom") return value;
  throw new ApiError(400, "invalid_query", "preset must be day, week, month, or custom");
}

export function parseActivityBucket(value: string | null): "5m" | "15m" | "1h" | "1d" | "1w" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "5m" || value === "15m" || value === "1h" || value === "1d" || value === "1w") return value;
  throw new ApiError(400, "invalid_query", "bucket must be 5m, 15m, 1h, 1d, or 1w");
}

export function parseActivityAutomation(value: string | null): "all" | "interactive" | "automated" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "all" || value === "interactive" || value === "automated") return value;
  throw new ApiError(400, "invalid_query", "automation must be all, interactive, or automated");
}

export function parseTrendGranularity(value: string | null): "day" | "week" | "month" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "day" || value === "week" || value === "month") return value;
  throw new ApiError(400, "invalid_query", "granularity must be day, week, or month");
}

export function parseSecretConfidence(value: string | null): "definite" | "candidate" | "all" | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "definite" || value === "candidate" || value === "all") return value;
  throw new ApiError(400, "invalid_query", "confidence must be definite, candidate, or all");
}

export function readNumericId(value: string | undefined, name: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(400, "invalid_payload", `${name} must be a non-negative integer`);
  }
  return parsed;
}

export async function readJsonBody(ctx: RequestContext, fallback?: Record<string, unknown>): Promise<unknown> {
  try {
    return await ctx.request.json();
  } catch {
    if (fallback !== undefined) return fallback;
    throw new ApiError(400, "invalid_payload", "request body must be valid JSON");
  }
}

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

export async function withArchiveStore(
  dbPath: string,
  ctx: RequestContext,
  callback: (store: SessionArchiveStore, sessionId: string) => Response | Promise<Response>,
  options?: { notify?: boolean },
): Promise<Response> {
  return withSessionArchiveStore({ dbPath }, async (store) => {
    const response = await callback(store, readSessionId(ctx));
    if (options?.notify) notifyArchiveDbChanged(dbPath);
    return response;
  });
}

export async function withWorkspaceArchiveStore(
  dbPath: string,
  callback: (store: SessionArchiveStore) => Response | Promise<Response>,
  options?: { notify?: boolean },
): Promise<Response> {
  return withSessionArchiveStore({ dbPath }, async (store) => {
    const response = await callback(store);
    if (options?.notify) notifyArchiveDbChanged(dbPath);
    return response;
  });
}
