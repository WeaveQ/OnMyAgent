import { describe, expect, test } from "bun:test";

import {
  createExpertSurfaceInitialState,
  reduceExpertSurface,
  selectExpertSurfaceNavigation,
  type ExpertSurfaceEvent,
  type ExpertSurfaceState,
} from "../src/react-app/domains/session/pages/expert-surface-machine";

const events: ExpertSurfaceEvent[] = [
  { type: "OPEN_DRAFT", workspaceId: "ws", agentId: "a", operationId: "op-a" },
  { type: "OPEN_DRAFT", workspaceId: "ws", agentId: "b", operationId: "op-b" },
  { type: "CREATE_BOUND", operationId: "op-a", sessionId: "ses-a" },
  { type: "CREATE_BOUND", operationId: "op-b", sessionId: "ses-b" },
  { type: "CREATE_BOUND", operationId: "stale", sessionId: "ses-stale" },
  { type: "REQUEST_NAVIGATION", operationId: "op-a" },
  { type: "REQUEST_NAVIGATION", operationId: "op-b" },
  { type: "OPEN_REAL_SESSION", workspaceId: "ws", agentId: "a", sessionId: "ses-a" },
  { type: "OPEN_REAL_SESSION", workspaceId: "ws", agentId: "b", sessionId: "ses-b" },
  { type: "CREATE_FAILED", operationId: "op-a" },
  { type: "RESET", workspaceId: "ws" },
];

function assertValid(state: ExpertSurfaceState) {
  if (state.kind === "real_session" || state.kind === "creating") {
    expect(state.sessionId.trim()).not.toBe("");
    expect(state.sessionId.startsWith("draft:")).toBe(false);
  }
  if (state.kind === "creating") {
    expect(state.operationId.trim()).not.toBe("");
    expect(state.agentId.trim()).not.toBe("");
  }
}

function walk(state: ExpertSurfaceState, depth: number) {
  assertValid(state);
  if (depth === 0) return;
  for (const event of events) walk(reduceExpertSurface(state, event), depth - 1);
}

describe("expert surface finite-state machine", () => {
  test("exhausts every event sequence through length four", () => {
    walk(createExpertSurfaceInitialState("ws"), 4);
  });

  test("ignores stale create completion and requests navigation once", () => {
    let state = reduceExpertSurface(createExpertSurfaceInitialState("ws"), {
      type: "OPEN_DRAFT",
      workspaceId: "ws",
      agentId: "new-agent",
      operationId: "new-op",
    });
    state = reduceExpertSurface(state, {
      type: "CREATE_BOUND",
      operationId: "old-op",
      sessionId: "ses-old",
    });
    expect(state.kind).toBe("idle_draft");

    state = reduceExpertSurface(state, {
      type: "CREATE_BOUND",
      operationId: "new-op",
      sessionId: "ses-new",
    });
    expect(selectExpertSurfaceNavigation(state)).toEqual({
      operationId: "new-op",
      sessionId: "ses-new",
    });
    state = reduceExpertSurface(state, {
      type: "REQUEST_NAVIGATION",
      operationId: "new-op",
    });
    expect(selectExpertSurfaceNavigation(state)).toBeNull();
    expect(
      reduceExpertSurface(state, {
        type: "REQUEST_NAVIGATION",
        operationId: "new-op",
      }),
    ).toBe(state);
  });

  test("explicit real-tab selection wins over a late create", () => {
    let state = reduceExpertSurface(createExpertSurfaceInitialState("ws"), {
      type: "OPEN_DRAFT",
      workspaceId: "ws",
      agentId: "a",
      operationId: "op-a",
    });
    state = reduceExpertSurface(state, {
      type: "OPEN_REAL_SESSION",
      workspaceId: "ws",
      agentId: "b",
      sessionId: "ses-b",
    });
    state = reduceExpertSurface(state, {
      type: "CREATE_BOUND",
      operationId: "op-a",
      sessionId: "ses-a",
    });
    expect(state).toEqual({
      kind: "real_session",
      workspaceId: "ws",
      agentId: "b",
      sessionId: "ses-b",
    });
  });
});
