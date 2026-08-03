import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONTEXT_LIMIT,
  bucketPercentOfTotal,
  contextUsagePercent,
  formatCompactTokens,
  lookupModelContextLimit,
  resolveContextTotal,
  toContextUsageSnapshot,
} from "../src/react-app/capabilities/context-usage/context-usage-model";
import {
  buildSessionContextUsage,
  estimateContextUsedFromTokens,
} from "../src/react-app/capabilities/context-usage/session-context-usage";

describe("context usage model", () => {
  test("resolveContextTotal prefers runtime → catalog → table → default", () => {
    expect(resolveContextTotal({ runtimeTotal: 192_000 })).toEqual({
      total: 192_000,
      source: "runtime",
    });
    expect(
      resolveContextTotal({
        catalogContextWindow: 128_000,
        modelId: "claude-sonnet-4.5",
      }),
    ).toEqual({ total: 128_000, source: "catalog" });
    expect(resolveContextTotal({ modelId: "claude-sonnet-4.5" })).toEqual({
      total: 1_000_000,
      source: "table",
    });
    expect(resolveContextTotal({ modelId: "totally-unknown-xyz" })).toEqual({
      total: DEFAULT_CONTEXT_LIMIT,
      source: "default",
    });
    expect(resolveContextTotal({})).toEqual({
      total: DEFAULT_CONTEXT_LIMIT,
      source: "default",
    });
  });

  test("lookupModelContextLimit fuzzy-matches and defaults", () => {
    expect(lookupModelContextLimit("gpt-4o")).toBe(128_000);
    expect(lookupModelContextLimit("claude-3.5-sonnet-latest")).toBe(200_000);
    expect(lookupModelContextLimit(null)).toBe(DEFAULT_CONTEXT_LIMIT);
  });

  test("toContextUsageSnapshot raises total when used exceeds total", () => {
    const snap = toContextUsageSnapshot({ used: 250, total: 100 });
    expect(snap?.used).toBe(250);
    expect(snap?.total).toBe(250);
  });

  test("toContextUsageSnapshot keeps valid breakdown", () => {
    const snap = toContextUsageSnapshot({
      used: 100,
      total: 200,
      breakdown: [
        { id: "system", tokens: 20 },
        { id: "messages", tokens: 80 },
      ],
    });
    expect(snap?.breakdown).toEqual([
      { id: "system", tokens: 20 },
      { id: "messages", tokens: 80 },
    ]);
    expect(bucketPercentOfTotal(20, 200)).toBe(10);
    expect(contextUsagePercent(100, 200)).toBe(50);
  });

  test("formatCompactTokens", () => {
    expect(formatCompactTokens(142_400)).toBe("142.4K");
    expect(formatCompactTokens(192_000)).toBe("192.0K");
    expect(formatCompactTokens(500)).toBe("500");
  });

  test("estimateContextUsedFromTokens sums input + cache read", () => {
    expect(estimateContextUsedFromTokens({ input: 100, cacheRead: 50 })).toBe(150);
    expect(estimateContextUsedFromTokens({ input: 80, cacheRead: null })).toBe(80);
    expect(estimateContextUsedFromTokens(null)).toBeNull();
  });

  test("buildSessionContextUsage always resolves total for empty sessions", () => {
    const snap = buildSessionContextUsage({
      modelId: "gpt-4o",
      usedTokens: null,
    });
    expect(snap.used).toBe(0);
    expect(snap.total).toBe(128_000);
    expect(snap.usedSource).toBe("estimate");
  });
});
