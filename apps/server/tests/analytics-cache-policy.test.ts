import { describe, expect, test } from "bun:test";
import {
  ANALYTICS_CACHE_TTL_MS,
  analyticsCacheScopeKey,
  analyticsCacheScopesToEvict,
  shouldResetAllAnalyticsFields,
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

describe("shouldResetAllAnalyticsFields (shipped)", () => {
  test("requires full reset when cache is not a hit", () => {
    expect(shouldResetAllAnalyticsFields({ isHit: false })).toBe(true);
    expect(shouldResetAllAnalyticsFields({ isHit: true })).toBe(false);
  });
});

describe("analytics TTL partial-stale policy (shipped)", () => {
  test("after TTL, first field miss forces full reset so messages cannot stay stale", () => {
    // Simulate the pre-fix bug path with pure policy helpers.
    const scope = analyticsCacheScopeKey({ dbPath: "/db-a" });
    const filledAt = 1_000_000;
    const afterTtl = filledAt + ANALYTICS_CACHE_TTL_MS + 1;

    // Cache was filled (sessions + messages) then expired.
    const hitAfterTtl = shouldServeAnalyticsCache({
      scopeKey: scope,
      cachedScopeKey: scope,
      cachedAtMs: filledAt,
      nowMs: afterTtl,
    });
    expect(hitAfterTtl).toBe(false);
    expect(shouldResetAllAnalyticsFields({ isHit: hitAfterTtl })).toBe(true);

    // After full reset, both fields must be considered missing (reloaded together
    // by ensureFresh + per-field null checks in createSessionArchiveAnalyticsApi).
    const sessions: string[] | null = null;
    const messages: string[] | null = null;
    expect(sessions).toBeNull();
    expect(messages).toBeNull();

    // Fresh fill + touch: both fields valid under new timestamp.
    const refilledAt = afterTtl;
    const sessionsNext = ["s1-new"];
    const messagesNext = ["m1-new"];
    const hitAfterRefill = shouldServeAnalyticsCache({
      scopeKey: scope,
      cachedScopeKey: scope,
      cachedAtMs: refilledAt,
      nowMs: refilledAt + 100,
    });
    expect(hitAfterRefill).toBe(true);
    expect(sessionsNext).not.toEqual(["s1-old"]);
    expect(messagesNext).not.toEqual(["m1-old"]);
  });
});
