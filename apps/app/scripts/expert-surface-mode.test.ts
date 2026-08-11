import { describe, expect, test } from "bun:test";

import {
  buildExpertDraftTabSessionId,
  isLiveExpertSessionSelection,
  readRealSessionId,
  selectExpertSurfaceMode,
} from "../src/react-app/domains/session/pages/expert-surface-mode";
import {
  shouldDropExpertSurfaceDraft,
  type ExpertSurfaceState,
} from "../src/react-app/domains/session/pages/expert-surface-machine";

function surfaceState(input: {
  routeSessionId?: string;
  routeAgentId?: string;
  draftAgentId?: string;
  boundSessionId?: string;
}): ExpertSurfaceState {
  return {
    workspaceId: "ws1",
    route: input.routeSessionId
      ? { sessionId: input.routeSessionId, agentId: input.routeAgentId ?? null }
      : null,
    draft: input.draftAgentId
      ? {
          agentId: input.draftAgentId,
          operationId: "op-1",
          boundSessionId: input.boundSessionId ?? null,
          navigation: "pending",
        }
      : null,
    pendingTabSessionId: input.boundSessionId ?? null,
  };
}

describe("readRealSessionId", () => {
  test("rejects empty and draft ids", () => {
    expect(readRealSessionId(null)).toBeNull();
    expect(readRealSessionId("")).toBeNull();
    expect(readRealSessionId("draft:ws")).toBeNull();
    expect(readRealSessionId("ses_abc")).toBe("ses_abc");
  });
});

describe("selectExpertSurfaceMode", () => {
  test("projects an unbound draft without a route", () => {
    const mode = selectExpertSurfaceMode(surfaceState({ draftAgentId: "order-entry" }));
    expect(mode.kind).toBe("idle_draft");
    expect(mode.draftOnly).toBe(true);
    expect(mode.showDraftChrome).toBe(true);
    expect(mode.sessionId).toBe("draft:ws1:order-entry");
  });

  test("keeps the real route painted while an unbound draft chip exists", () => {
    const mode = selectExpertSurfaceMode(surfaceState({
      routeSessionId: "ses_old",
      routeAgentId: "other-agent",
      draftAgentId: "order-entry",
    }));
    expect(mode.kind).toBe("real_session");
    expect(mode.sessionId).toBe("ses_old");
    expect(mode.showDraftChrome).toBe(true);
    expect(mode.conversationAgentId).toBe("order-entry");
  });

  test("projects a bound create before route activation", () => {
    const mode = selectExpertSurfaceMode(surfaceState({
      draftAgentId: "order-entry",
      boundSessionId: "ses_new",
    }));
    expect(mode.kind).toBe("creating");
    expect(mode.sessionId).toBe("ses_new");
    expect(mode.creatingSessionId).toBe("ses_new");
    expect(mode.mayForceNavToBound).toBe(true);
  });

  test("projects the bound session once its route arrives", () => {
    const mode = selectExpertSurfaceMode(surfaceState({
      routeSessionId: "ses_new",
      routeAgentId: "order-entry",
      draftAgentId: "order-entry",
      boundSessionId: "ses_new",
    }));
    expect(mode.kind).toBe("real_session");
    expect(mode.sessionId).toBe("ses_new");
    expect(mode.creatingSessionId).toBeNull();
    expect(mode.mayForceNavToBound).toBe(false);
  });

  test("projects an explicitly selected other route over a late create", () => {
    const mode = selectExpertSurfaceMode(surfaceState({
      routeSessionId: "ses_other",
      routeAgentId: "other-agent",
      draftAgentId: "order-entry",
      boundSessionId: "ses_new",
    }));
    expect(mode.kind).toBe("real_session");
    expect(mode.sessionId).toBe("ses_other");
    expect(mode.creatingSessionId).toBe("ses_new");
    expect(mode.mayForceNavToBound).toBe(false);
  });

  test("projects a route without a draft", () => {
    const mode = selectExpertSurfaceMode(surfaceState({
      routeSessionId: "ses_hist",
      routeAgentId: "order-entry",
    }));
    expect(mode.kind).toBe("real_session");
    expect(mode.sessionId).toBe("ses_hist");
    expect(mode.conversationAgentId).toBe("order-entry");
  });

  test("projects an empty shell without draft chrome", () => {
    const mode = selectExpertSurfaceMode(surfaceState({}));
    expect(mode.kind).toBe("idle_draft");
    expect(mode.draftOnly).toBe(true);
    expect(mode.showDraftChrome).toBe(false);
  });
});

describe("shouldDropExpertSurfaceDraft", () => {
  test("keeps unbound drafts while route activation catches up", () => {
    expect(shouldDropExpertSurfaceDraft(surfaceState({
      routeSessionId: "ses_hist",
      draftAgentId: "a",
    }))).toBe(false);
  });

  test("drops a bound draft after the user opens another real tab", () => {
    expect(shouldDropExpertSurfaceDraft(surfaceState({
      routeSessionId: "ses_other",
      draftAgentId: "a",
      boundSessionId: "ses_new",
    }))).toBe(true);
  });

  test("keeps a bound draft with an empty or matching route", () => {
    expect(shouldDropExpertSurfaceDraft(surfaceState({
      draftAgentId: "a",
      boundSessionId: "ses_new",
    }))).toBe(false);
    expect(shouldDropExpertSurfaceDraft(surfaceState({
      routeSessionId: "ses_new",
      draftAgentId: "a",
      boundSessionId: "ses_new",
    }))).toBe(false);
  });
});

describe("buildExpertDraftTabSessionId", () => {
  test("includes agent when present", () => {
    expect(buildExpertDraftTabSessionId("ws", "a1")).toBe("draft:ws:a1");
    expect(buildExpertDraftTabSessionId("ws", null)).toBe("draft:ws");
  });
});

describe("isLiveExpertSessionSelection", () => {
  test("treats deleted ses id as dead once inventory is ready", () => {
    expect(isLiveExpertSessionSelection({
      selectedSessionId: "ses_deleted",
      liveSessionIds: ["ses_other"],
      inventoryReady: true,
    })).toBe(false);
    expect(isLiveExpertSessionSelection({
      selectedSessionId: "ses_other",
      liveSessionIds: ["ses_other"],
      inventoryReady: true,
    })).toBe(true);
  });

  test("keeps selection while inventory is still loading", () => {
    expect(isLiveExpertSessionSelection({
      selectedSessionId: "ses_maybe",
      liveSessionIds: [],
      inventoryReady: false,
    })).toBe(true);
  });
});
