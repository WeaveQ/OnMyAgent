import { describe, expect, test } from "bun:test";
import {
  ANALYTICS_CACHE_TTL_MS,
  analyticsCacheScopeKey,
  analyticsCacheScopesToEvict,
  shouldServeAnalyticsCache,
} from "../src/services/analytics-cache-policy.js";

describe("analyticsCacheScopeKey (shipped)", () => {
  test("scopes by dbPath and optional workspaceId", () => {
    expect(analyticsCacheScopeKey({ dbPath: "/a/archive.sqlite" })).toBe(
      "/a/archive.sqlite",
    );
    expect(
      analyticsCacheScopeKey({
        dbPath: "/a/archive.sqlite",
        workspaceId: "ws-1",
      }),
    ).toBe("ws-1::/a/archive.sqlite");
    expect(
      analyticsCacheScopeKey({
        dbPath: "/a/archive.sqlite",
        workspaceId: "ws-1",
      }),
    ).not.toBe(
      analyticsCacheScopeKey({
        dbPath: "/b/archive.sqlite",
        workspaceId: "ws-1",
      }),
    );
  });
});

describe("shouldServeAnalyticsCache (shipped)", () => {
  test("rejects missing, wrong scope, or expired entries", () => {
    const scope = analyticsCacheScopeKey({ dbPath: "/db-a" });
    const now = 1_000_000;
    expect(
      shouldServeAnalyticsCache({
        scopeKey: scope,
        cachedScopeKey: null,
        cachedAtMs: now,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      shouldServeAnalyticsCache({
        scopeKey: scope,
        cachedScopeKey: analyticsCacheScopeKey({ dbPath: "/db-b" }),
        cachedAtMs: now,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      shouldServeAnalyticsCache({
        scopeKey: scope,
        cachedScopeKey: scope,
        cachedAtMs: now - ANALYTICS_CACHE_TTL_MS - 1,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      shouldServeAnalyticsCache({
        scopeKey: scope,
        cachedScopeKey: scope,
        cachedAtMs: now - 1_000,
        nowMs: now,
      }),
    ).toBe(true);
  });
});

describe("analyticsCacheScopesToEvict (shipped)", () => {
  test("evicts oldest when over max scopes", () => {
    const evict = analyticsCacheScopesToEvict({
      maxScopes: 2,
      scopes: [
        { scopeKey: "a", cachedAtMs: 1 },
        { scopeKey: "b", cachedAtMs: 3 },
        { scopeKey: "c", cachedAtMs: 2 },
      ],
    });
    expect(evict).toEqual(["a"]);
  });
});
