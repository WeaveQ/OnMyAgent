import { describe, expect, test } from "bun:test";

import {
  createExpertSurfaceInitialState,
  reduceExpertSurface,
  selectExpertSurfaceNavigation,
  shouldDropExpertSurfaceDraft,
  type ExpertSurfaceEvent,
  type ExpertSurfaceState,
} from "../src/react-app/domains/session/pages/expert-surface-machine";
import { selectExpertSurfaceMode } from "../src/react-app/domains/session/pages/expert-surface-mode";
import { shouldSuppressExpertColdOpen } from "../src/react-app/domains/session/pages/order-conversation-groups";

function suppressFromSurface(state: ExpertSurfaceState): boolean {
  return shouldSuppressExpertColdOpen({
    draftSessionActive: state.draft !== null,
    draftAgentId: state.draft?.agentId ?? null,
    creatingSessionId: selectExpertSurfaceMode(state).creatingSessionId,
    tabHighlightSessionId: state.pendingTabSessionId,
  });
}

const events: ExpertSurfaceEvent[] = [
  { type: "OPEN_DRAFT", workspaceId: "ws", agentId: "a", operationId: "op-a" },
  { type: "OPEN_DRAFT", workspaceId: "ws", agentId: "b", operationId: "op-b" },
  { type: "CREATE_BOUND", operationId: "op-a", sessionId: "ses-a" },
  { type: "CREATE_BOUND", operationId: "op-b", sessionId: "ses-b" },
  { type: "CREATE_BOUND", operationId: "stale", sessionId: "ses-stale" },
  { type: "REQUEST_NAVIGATION", operationId: "op-a" },
  { type: "REQUEST_NAVIGATION", operationId: "op-b" },
  { type: "SYNC_ROUTE", workspaceId: "ws", agentId: "a", sessionId: "ses-a" },
  { type: "SYNC_ROUTE", workspaceId: "ws", agentId: "b", sessionId: "ses-b" },
  { type: "SET_PENDING_TAB", sessionId: "ses-a" },
  { type: "CLEAR_DRAFT" },
  { type: "CREATE_FAILED", operationId: "op-a" },
  { type: "RESET", workspaceId: "ws" },
];

function assertRealSessionId(sessionId: string) {
  expect(sessionId.trim()).not.toBe("");
  expect(sessionId.startsWith("draft:")).toBe(false);
}

function assertValid(state: ExpertSurfaceState) {
  expect(state.workspaceId.trim()).not.toBe("");
  if (state.route) assertRealSessionId(state.route.sessionId);
  if (state.pendingTabSessionId) assertRealSessionId(state.pendingTabSessionId);
  if (state.draft) {
    expect(state.draft.operationId.trim()).not.toBe("");
    expect(state.draft.agentId.trim()).not.toBe("");
    if (state.draft.boundSessionId) {
      assertRealSessionId(state.draft.boundSessionId);
    }
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
    expect(state.draft?.boundSessionId).toBeNull();

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

  test("explicit draft clear lets a real-tab selection win over a late create", () => {
    let state = reduceExpertSurface(createExpertSurfaceInitialState("ws"), {
      type: "OPEN_DRAFT",
      workspaceId: "ws",
      agentId: "a",
      operationId: "op-a",
    });
    state = reduceExpertSurface(state, {
      type: "SYNC_ROUTE",
      workspaceId: "ws",
      agentId: "b",
      sessionId: "ses-b",
    });
    state = reduceExpertSurface(state, {
      type: "CREATE_BOUND",
      operationId: "op-a",
      sessionId: "ses-a",
    });
    state = reduceExpertSurface(state, { type: "CLEAR_DRAFT" });
    expect(state.route).toEqual({ agentId: "b", sessionId: "ses-b" });
    expect(state.draft).toBeNull();
  });

  test("does not mistake the route under a new-session draft for a user switch", () => {
    let state = reduceExpertSurface(createExpertSurfaceInitialState("ws"), {
      type: "SYNC_ROUTE",
      workspaceId: "ws",
      agentId: "b",
      sessionId: "ses-b",
    });
    state = reduceExpertSurface(state, {
      type: "OPEN_DRAFT",
      workspaceId: "ws",
      agentId: "a",
      operationId: "op-a",
    });
    state = reduceExpertSurface(state, {
      type: "CREATE_BOUND",
      operationId: "op-a",
      sessionId: "ses-a",
    });

    expect(state.route).toEqual({ agentId: "b", sessionId: "ses-b" });
    expect(state.draft?.sourceRouteSessionId).toBe("ses-b");
    expect(shouldDropExpertSurfaceDraft(state)).toBe(false);
    expect(selectExpertSurfaceMode(state)).toMatchObject({
      kind: "creating",
      sessionId: "ses-a",
      conversationAgentId: "a",
      mayForceNavToBound: true,
    });
    expect(selectExpertSurfaceNavigation(state)).toEqual({
      operationId: "op-a",
      sessionId: "ses-a",
    });
  });

  test("SYNC_ROUTE to a new route remains explicit leave intent", () => {
    let state = reduceExpertSurface(createExpertSurfaceInitialState("ws"), {
      type: "OPEN_DRAFT",
      workspaceId: "ws",
      agentId: "a",
      operationId: "op-a",
    });
    state = reduceExpertSurface(state, {
      type: "CREATE_BOUND",
      operationId: "op-a",
      sessionId: "ses-a",
    });
    state = reduceExpertSurface(state, {
      type: "SYNC_ROUTE",
      workspaceId: "ws",
      agentId: "b",
      sessionId: "ses-b",
    });
    expect(state.route).toEqual({ agentId: "b", sessionId: "ses-b" });
    expect(state.draft?.boundSessionId).toBe("ses-a");
    expect(state.pendingTabSessionId).toBe("ses-a");
    expect(shouldDropExpertSurfaceDraft(state)).toBe(true);
    expect(selectExpertSurfaceMode(state).mayForceNavToBound).toBe(false);
    expect(suppressFromSurface(state)).toBe(true);
  });

  test("SYNC_ROUTE to the bound session keeps the create draft", () => {
    let state = reduceExpertSurface(createExpertSurfaceInitialState("ws"), {
      type: "OPEN_DRAFT",
      workspaceId: "ws",
      agentId: "a",
      operationId: "op-a",
    });
    state = reduceExpertSurface(state, {
      type: "CREATE_BOUND",
      operationId: "op-a",
      sessionId: "ses-a",
    });
    state = reduceExpertSurface(state, {
      type: "SYNC_ROUTE",
      workspaceId: "ws",
      agentId: "a",
      sessionId: "ses-a",
    });
    expect(state.draft?.boundSessionId).toBe("ses-a");
    expect(state.route).toEqual({ agentId: "a", sessionId: "ses-a" });
    expect(selectExpertSurfaceMode(state).creatingSessionId).toBeNull();
  });

  test("switching workspace clears the old draft and pending tab atomically", () => {
    let state = reduceExpertSurface(createExpertSurfaceInitialState("ws-a"), {
      type: "OPEN_DRAFT",
      workspaceId: "ws-a",
      agentId: "a",
      operationId: "op-a",
    });
    state = reduceExpertSurface(state, {
      type: "CREATE_BOUND",
      operationId: "op-a",
      sessionId: "ses-a",
    });
    state = reduceExpertSurface(state, {
      type: "SYNC_ROUTE",
      workspaceId: "ws-b",
      agentId: "b",
      sessionId: "ses-b",
    });
    expect(state).toEqual({
      workspaceId: "ws-b",
      route: { agentId: "b", sessionId: "ses-b" },
      draft: null,
      pendingTabSessionId: null,
    });
  });
});
