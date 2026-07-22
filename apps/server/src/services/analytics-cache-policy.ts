/**
 * Pure helpers for session-archive analytics TTL cache scoping.
 * Prevents serving workspace A's aggregates under workspace B's db scope.
 */

export const ANALYTICS_CACHE_TTL_MS = 30_000;
export const ANALYTICS_CACHE_MAX_SCOPES = 32;

export type AnalyticsCacheScopeKey = string;

export function analyticsCacheScopeKey(input: {
  dbPath: string;
  workspaceId?: string;
}): AnalyticsCacheScopeKey {
  const db = input.dbPath.trim();
  const ws = (input.workspaceId ?? "").trim();
  return ws ? `${ws}::${db}` : db;
}

export function shouldServeAnalyticsCache(input: {
  scopeKey: AnalyticsCacheScopeKey;
  cachedScopeKey: AnalyticsCacheScopeKey | null | undefined;
  cachedAtMs: number;
  nowMs: number;
  ttlMs?: number;
}): boolean {
  if (!input.cachedScopeKey) return false;
  if (input.cachedScopeKey !== input.scopeKey) return false;
  const ttl = input.ttlMs ?? ANALYTICS_CACHE_TTL_MS;
  return input.nowMs - input.cachedAtMs <= ttl;
}

/**
 * LRU-ish prune: when over max scopes, drop oldest by timestamp.
 * Returns scopes to delete (not including keepScope if present).
 */
export function analyticsCacheScopesToEvict(input: {
  scopes: Array<{ scopeKey: string; cachedAtMs: number }>;
  maxScopes?: number;
}): string[] {
  const max = input.maxScopes ?? ANALYTICS_CACHE_MAX_SCOPES;
  if (input.scopes.length <= max) return [];
  const sorted = [...input.scopes].sort((a, b) => a.cachedAtMs - b.cachedAtMs);
  const excess = input.scopes.length - max;
  return sorted.slice(0, excess).map((row) => row.scopeKey);
}
