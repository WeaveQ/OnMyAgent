import { describe, expect, test } from "bun:test";

import {
  buildExpertDraftTabSessionId,
  isLiveExpertSessionSelection,
  readRealSessionId,
  resolveExpertSurfaceMode,
  shouldDropDraftIntentForRoute,
} from "../src/react-app/domains/session/pages/expert-surface-mode";

describe("readRealSessionId", () => {
  test("rejects empty and draft ids", () => {
    expect(readRealSessionId(null)).toBeNull();
    expect(readRealSessionId("")).toBeNull();
    expect(readRealSessionId("draft:ws")).toBeNull();
    expect(readRealSessionId("ses_abc")).toBe("ses_abc");
  });
});

describe("resolveExpertSurfaceMode", () => {
  const base = {
    workspaceId: "ws1",
    draftAgentId: "order-entry" as string | null,
    pendingAgentId: "order-entry" as string | null,
    selectedSessionAgentId: null as string | null,
  };

  test("idle_draft: user opened 去聊天 / 新会话 with no bind yet", () => {
    const mode = resolveExpertSurfaceMode({
      ...base,
      selectedSessionId: null,
      draftIntent: true,
      pendingBoundSessionId: undefined,
    });
    expect(mode.kind).toBe("idle_draft");
    expect(mode.draftOnly).toBe(true);
    expect(mode.showDraftChrome).toBe(true);
    expect(mode.sessionId).toBe("draft:ws1:order-entry");
    expect(mode.mayForceNavToBound).toBe(false);
    expect(mode.creatingSessionId).toBeNull();
  });

  test("unbound draftIntent with a real route never draftOnly (multi-switch blank guard)", () => {
    // Stuck draftIntent used to ignore route → draftOnly + white surface.
    // Route owns paint; draft chrome may still show until openFresh clears route.
    const mode = resolveExpertSurfaceMode({
      ...base,
      selectedSessionId: "ses_old",
      selectedSessionAgentId: "other-agent",
      draftIntent: true,
      pendingBoundSessionId: undefined,
    });
    expect(mode.kind).toBe("real_session");
    expect(mode.draftOnly).toBe(false);
    expect(mode.sessionId).toBe("ses_old");
    expect(mode.showDraftChrome).toBe(true);
    expect(mode.conversationAgentId).toBe("order-entry");
  });

  test("creating: first send bound, route not yet on bound → force-nav allowed", () => {
    const mode = resolveExpertSurfaceMode({
      ...base,
      selectedSessionId: null,
      draftIntent: true,
      pendingBoundSessionId: "ses_new",
    });
    expect(mode.kind).toBe("creating");
    expect(mode.draftOnly).toBe(false);
    expect(mode.showDraftChrome).toBe(false);
    expect(mode.sessionId).toBe("ses_new");
    expect(mode.creatingSessionId).toBe("ses_new");
    expect(mode.mayForceNavToBound).toBe(true);
  });

  test("real_session after route lands on bound create", () => {
    const mode = resolveExpertSurfaceMode({
      ...base,
      selectedSessionId: "ses_new",
      selectedSessionAgentId: "order-entry",
      draftIntent: true,
      pendingBoundSessionId: "ses_new",
    });
    expect(mode.kind).toBe("real_session");
    expect(mode.draftOnly).toBe(false);
    expect(mode.showDraftChrome).toBe(false);
    expect(mode.sessionId).toBe("ses_new");
    expect(mode.mayForceNavToBound).toBe(false);
    expect(mode.creatingSessionId).toBeNull();
  });

  test("user left creating: route on other real tab → no force-nav, no draft chrome", () => {
    const mode = resolveExpertSurfaceMode({
      ...base,
      selectedSessionId: "ses_other",
      selectedSessionAgentId: "order-entry",
      draftIntent: true,
      pendingBoundSessionId: "ses_new",
    });
    expect(mode.kind).toBe("real_session");
    expect(mode.sessionId).toBe("ses_other");
    expect(mode.draftOnly).toBe(false);
    expect(mode.showDraftChrome).toBe(false);
    expect(mode.mayForceNavToBound).toBe(false);
    expect(mode.creatingSessionId).toBe("ses_new");
  });

  test("real_session without draft intent", () => {
    const mode = resolveExpertSurfaceMode({
      ...base,
      selectedSessionId: "ses_hist",
      selectedSessionAgentId: "order-entry",
      draftIntent: false,
      draftAgentId: null,
      pendingAgentId: null,
      pendingBoundSessionId: undefined,
    });
    expect(mode.kind).toBe("real_session");
    expect(mode.sessionId).toBe("ses_hist");
    expect(mode.draftOnly).toBe(false);
    expect(mode.showDraftChrome).toBe(false);
    expect(mode.conversationAgentId).toBe("order-entry");
  });

  test("empty route without intent is empty idle shell without draft chrome", () => {
    const mode = resolveExpertSurfaceMode({
      ...base,
      selectedSessionId: null,
      draftIntent: false,
      draftAgentId: null,
      pendingAgentId: null,
      pendingBoundSessionId: undefined,
      selectedSessionAgentId: null,
    });
    expect(mode.kind).toBe("idle_draft");
    expect(mode.draftOnly).toBe(true);
    expect(mode.showDraftChrome).toBe(false);
  });
});

describe("shouldDropDraftIntentForRoute", () => {
  test("does not drop unbound draft on residual real route (openFresh lag)", () => {
    expect(
      shouldDropDraftIntentForRoute({
        draftIntent: true,
        selectedSessionId: "ses_hist",
        pendingBoundSessionId: undefined,
      }),
    ).toBe(false);
  });

  test("drops creating draft when user opens a different real tab", () => {
    expect(
      shouldDropDraftIntentForRoute({
        draftIntent: true,
        selectedSessionId: "ses_other",
        pendingBoundSessionId: "ses_new",
      }),
    ).toBe(true);
  });

  test("keeps draft when route is empty or still on bound create", () => {
    expect(
      shouldDropDraftIntentForRoute({
        draftIntent: true,
        selectedSessionId: null,
        pendingBoundSessionId: "ses_new",
      }),
    ).toBe(false);
    expect(
      shouldDropDraftIntentForRoute({
        draftIntent: true,
        selectedSessionId: "ses_new",
        pendingBoundSessionId: "ses_new",
      }),
    ).toBe(false);
  });
});

describe("buildExpertDraftTabSessionId", () => {
  test("includes agent when present", () => {
    expect(buildExpertDraftTabSessionId("ws", "a1")).toBe("draft:ws:a1");
    expect(buildExpertDraftTabSessionId("ws", null)).toBe("draft:ws");
  });
});

describe("isLiveExpertSessionSelection", () => {
  test("treats deleted ses id as dead once inventory is ready (delete → white guard)", () => {
    expect(
      isLiveExpertSessionSelection({
        selectedSessionId: "ses_deleted",
        liveSessionIds: ["ses_other"],
        inventoryReady: true,
      }),
    ).toBe(false);
    expect(
      isLiveExpertSessionSelection({
        selectedSessionId: "ses_other",
        liveSessionIds: ["ses_other"],
        inventoryReady: true,
      }),
    ).toBe(true);
  });

  test("keeps selection while inventory is still loading", () => {
    expect(
      isLiveExpertSessionSelection({
        selectedSessionId: "ses_maybe",
        liveSessionIds: [],
        inventoryReady: false,
      }),
    ).toBe(true);
  });
});
