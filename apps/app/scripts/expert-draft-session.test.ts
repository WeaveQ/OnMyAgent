import { describe, expect, test } from "bun:test";

import {
  resolveBoundExpertDraftSession,
  resolveExpertSurfaceSession,
  resolveReadyBoundExpertDraftSession,
  shouldKeepUnboundNewSessionDraft,
} from "../src/react-app/domains/session/pages/expert-draft-session";

describe("expert draft session activation", () => {
  test("activates the real session bound by the first draft send", () => {
    expect(resolveBoundExpertDraftSession({
      draftSessionActive: true,
      draftAgentId: "order-entry",
      pendingAgent: {
        id: "order-entry",
        boundSessionId: "ses_new",
      },
    })).toBe("ses_new");
  });

  test("does not switch for stale agents, drafts, or inactive draft mode", () => {
    expect(resolveBoundExpertDraftSession({
      draftSessionActive: true,
      draftAgentId: "order-entry",
      pendingAgent: { id: "other", boundSessionId: "ses_other" },
    })).toBeNull();
    expect(resolveBoundExpertDraftSession({
      draftSessionActive: true,
      draftAgentId: "order-entry",
      pendingAgent: { id: "order-entry", boundSessionId: "draft:ws" },
    })).toBeNull();
    expect(resolveBoundExpertDraftSession({
      draftSessionActive: false,
      draftAgentId: "order-entry",
      pendingAgent: { id: "order-entry", boundSessionId: "ses_new" },
    })).toBeNull();
  });

  test("keeps the expert draft visible until the created session route is selected", () => {
    const input = {
      draftSessionActive: true,
      draftAgentId: "order-entry",
      pendingAgent: {
        id: "order-entry",
        boundSessionId: "ses_new",
      },
    };
    expect(resolveReadyBoundExpertDraftSession({
      ...input,
      selectedSessionId: "ses_previous",
    })).toBeNull();
    expect(resolveReadyBoundExpertDraftSession({
      ...input,
      selectedSessionId: "ses_new",
    })).toBe("ses_new");
  });

  test("exposes the bound session before route selection catches up", () => {
    expect(resolveBoundExpertDraftSession({
      draftSessionActive: true,
      draftAgentId: "order-entry",
      pendingAgent: {
        id: "order-entry",
        boundSessionId: "ses_new",
      },
    })).toBe("ses_new");
  });

  test("keeps unbound +新会话 draft even when route still points at prior tab", () => {
    expect(
      shouldKeepUnboundNewSessionDraft({
        draftSessionActive: true,
        draftAgentId: "fulfillment-specialist",
        pendingDraftSource: "new-session",
        pendingAgentId: "fulfillment-specialist",
        pendingBoundSessionId: undefined,
        selectedSessionAgentId: "fulfillment-specialist",
      }),
    ).toBe(true);

    // Prior tab of the same expert must not kill the new draft.
    expect(
      shouldKeepUnboundNewSessionDraft({
        draftSessionActive: true,
        draftAgentId: "fulfillment-specialist",
        pendingDraftSource: "new-session",
        pendingAgentId: "fulfillment-specialist",
        selectedSessionAgentId: "fulfillment-specialist",
      }),
    ).toBe(true);
  });

  test("keeps marketplace summon draft while previous expert is still on the route", () => {
    // Regression: summon fleet while freight CS session is selected must keep draft.
    expect(
      shouldKeepUnboundNewSessionDraft({
        draftSessionActive: true,
        draftAgentId: "fleet-management-specialist",
        pendingDraftSource: "agent-selection",
        pendingAgentId: "fleet-management-specialist",
        selectedSessionAgentId: "order-dispatch-specialist",
      }),
    ).toBe(true);

    // create-task briefly clears pending before re-activate
    expect(
      shouldKeepUnboundNewSessionDraft({
        draftSessionActive: true,
        draftAgentId: "fleet-management-specialist",
        pendingDraftSource: null,
        pendingAgentId: null,
        selectedSessionAgentId: "order-dispatch-specialist",
      }),
    ).toBe(true);

    // +新会话 also survives previous expert still on route for a tick
    expect(
      shouldKeepUnboundNewSessionDraft({
        draftSessionActive: true,
        draftAgentId: "fulfillment-specialist",
        pendingDraftSource: "new-session",
        pendingAgentId: "fulfillment-specialist",
        selectedSessionAgentId: "logistics-finance-specialist",
      }),
    ).toBe(true);
  });

  test("does not keep draft after first send binds a real session", () => {
    expect(
      shouldKeepUnboundNewSessionDraft({
        draftSessionActive: true,
        draftAgentId: "fulfillment-specialist",
        pendingDraftSource: "new-session",
        pendingAgentId: "fulfillment-specialist",
        pendingBoundSessionId: "ses_created",
        selectedSessionAgentId: "fulfillment-specialist",
      }),
    ).toBe(false);
  });

  test("surface follows bound session before route selection leaves draft-home", () => {
    // Regression: tab shows 总结中… on ses_new while content still draftOnly.
    expect(
      resolveExpertSurfaceSession({
        draftSessionActive: true,
        draftAgentId: "kol-project-review-specialist",
        pendingAgent: {
          id: "kol-project-review-specialist",
          boundSessionId: "ses_new",
        },
        activeDraftSessionId: "draft:ws:kol-project-review-specialist",
        selectedSessionId: null,
        workspaceId: "ws",
      }),
    ).toEqual({ sessionId: "ses_new", draftOnly: false });

    expect(
      resolveExpertSurfaceSession({
        draftSessionActive: true,
        draftAgentId: "kol-project-review-specialist",
        pendingAgent: {
          id: "kol-project-review-specialist",
          boundSessionId: "ses_new",
        },
        activeDraftSessionId: "draft:ws:kol-project-review-specialist",
        selectedSessionId: "ses_previous",
        workspaceId: "ws",
      }),
    ).toEqual({ sessionId: "ses_new", draftOnly: false });

    expect(
      resolveExpertSurfaceSession({
        draftSessionActive: true,
        draftAgentId: "kol-project-review-specialist",
        pendingAgent: {
          id: "kol-project-review-specialist",
        },
        activeDraftSessionId: "draft:ws:kol-project-review-specialist",
        selectedSessionId: null,
        workspaceId: "ws",
      }),
    ).toEqual({
      sessionId: "draft:ws:kol-project-review-specialist",
      draftOnly: true,
    });
  });
});
