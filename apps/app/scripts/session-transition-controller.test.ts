import { describe, expect, test } from "bun:test";

import { deriveSessionRenderModel } from "../src/react-app/domains/session/sync/transition-controller";

describe("session transition controller", () => {
  test("renders stale cache while switching sessions", () => {
    expect(deriveSessionRenderModel({
      intendedSessionId: "session-new",
      renderedSessionId: "session-old",
      hasSnapshot: false,
      isFetching: true,
      isError: false,
    })).toEqual({
      intendedSessionId: "session-new",
      renderedSessionId: "session-old",
      transitionState: "switching",
      renderSource: "cache",
    });
  });

  test("keeps stale cache in recovering state when fetch fails during a switch", () => {
    expect(deriveSessionRenderModel({
      intendedSessionId: "session-new",
      renderedSessionId: "session-old",
      hasSnapshot: false,
      isFetching: false,
      isError: true,
    })).toEqual({
      intendedSessionId: "session-new",
      renderedSessionId: "session-old",
      transitionState: "recovering",
      renderSource: "recovering",
    });
  });

  test("reports failed state when the intended session itself fails", () => {
    expect(deriveSessionRenderModel({
      intendedSessionId: "session-a",
      renderedSessionId: "session-a",
      hasSnapshot: false,
      isFetching: false,
      isError: true,
    })).toEqual({
      intendedSessionId: "session-a",
      renderedSessionId: "session-a",
      transitionState: "failed",
      renderSource: "error",
    });
  });

  test("uses empty source while fetching before the first snapshot", () => {
    expect(deriveSessionRenderModel({
      intendedSessionId: "session-a",
      renderedSessionId: null,
      hasSnapshot: false,
      isFetching: true,
      isError: false,
    })).toEqual({
      intendedSessionId: "session-a",
      renderedSessionId: null,
      transitionState: "switching",
      renderSource: "empty",
    });
  });

  test("uses live source for snapshots and preserves fetch transition", () => {
    expect(deriveSessionRenderModel({
      intendedSessionId: "session-a",
      renderedSessionId: "session-a",
      hasSnapshot: true,
      isFetching: true,
      isError: false,
    })).toEqual({
      intendedSessionId: "session-a",
      renderedSessionId: "session-a",
      transitionState: "switching",
      renderSource: "live",
    });

    expect(deriveSessionRenderModel({
      intendedSessionId: "session-a",
      renderedSessionId: "session-a",
      hasSnapshot: true,
      isFetching: false,
      isError: false,
    })).toEqual({
      intendedSessionId: "session-a",
      renderedSessionId: "session-a",
      transitionState: "idle",
      renderSource: "live",
    });
  });
});
