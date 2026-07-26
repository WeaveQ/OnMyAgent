import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SECONDARY_RAIL_KEEP_ALIVE_MAX,
  isSecondaryRailKeepAliveKey,
  nextVisitedRailViews,
  SESSION_RAIL_KEEP_ALIVE_PANE_KEYS,
} from "../src/react-app/domains/session/pages/rail-keep-alive-lru";

describe("nextVisitedRailViews (secondary rail keep-alive LRU)", () => {
  test("default max is 3 secondary panes", () => {
    expect(DEFAULT_SECONDARY_RAIL_KEEP_ALIVE_MAX).toBe(3);
  });

  test("adds first visit and preserves order", () => {
    const next = nextVisitedRailViews(["assistant"], "files", 3);
    expect([...next]).toEqual(["assistant", "files"]);
  });

  test("revisit moves key to most-recent (end)", () => {
    const next = nextVisitedRailViews(
      ["assistant", "files", "store", "localAgent"],
      "files",
      3,
    );
    expect([...next]).toEqual(["assistant", "store", "localAgent", "files"]);
  });

  test("evicts oldest secondary when over max", () => {
    // start with 3 secondaries + primary
    let visited = nextVisitedRailViews(["assistant"], "files", 3);
    visited = nextVisitedRailViews(visited, "store", 3);
    visited = nextVisitedRailViews(visited, "localAgent", 3);
    expect([...visited].filter(isSecondaryRailKeepAliveKey)).toEqual([
      "files",
      "store",
      "localAgent",
    ]);
    // 4th secondary evicts files
    visited = nextVisitedRailViews(visited, "billing", 3);
    expect([...visited].filter(isSecondaryRailKeepAliveKey)).toEqual([
      "store",
      "localAgent",
      "billing",
    ]);
    expect(visited.has("files")).toBe(false);
    expect(visited.has("assistant")).toBe(true);
  });

  test("primary/non-secondary keys never count against the budget", () => {
    let visited = nextVisitedRailViews([], "assistant", 2);
    visited = nextVisitedRailViews(visited, "chat", 2);
    visited = nextVisitedRailViews(visited, "files", 2);
    visited = nextVisitedRailViews(visited, "store", 2);
    visited = nextVisitedRailViews(visited, "billing", 2);
    expect(visited.has("assistant")).toBe(true);
    expect(visited.has("chat")).toBe(true);
    expect([...visited].filter(isSecondaryRailKeepAliveKey)).toEqual([
      "store",
      "billing",
    ]);
  });

  test("max=0 keeps no secondary panes", () => {
    const next = nextVisitedRailViews(["assistant", "files"], "store", 0);
    expect(next.has("files")).toBe(false);
    expect(next.has("store")).toBe(false);
    expect(next.has("assistant")).toBe(true);
  });

  test("SESSION_RAIL_KEEP_ALIVE_PANE_KEYS are all secondary", () => {
    for (const key of SESSION_RAIL_KEEP_ALIVE_PANE_KEYS) {
      expect(isSecondaryRailKeepAliveKey(key)).toBe(true);
    }
    expect(isSecondaryRailKeepAliveKey("assistant")).toBe(false);
    expect(isSecondaryRailKeepAliveKey("chat")).toBe(false);
  });
});
