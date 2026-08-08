import { describe, expect, test } from "bun:test";

import {
  consumeBoundExpertDraftContext,
  matchesExpertDraftTransaction,
  resolveBoundExpertDraftNavigation,
  resolveBoundExpertDraftSession,
  resolveReadyBoundExpertDraftSession,
  shouldKeepUnboundExpertDraft,
} from "../src/react-app/domains/session/pages/expert-draft-session";

describe("expert draft session activation", () => {
  test("consumes the bound draft so no ghost new-session tab remains", () => {
    const contexts = {
      "order-entry": { conversationStartId: 101, label: "draft" },
    };
    expect(consumeBoundExpertDraftContext({
      contexts,
      agentId: "order-entry",
      conversationStartId: 101,
    })).toEqual({});
  });

  test("requests navigation once only while the bound session is not selected", () => {
    const input = {
      contexts: { "order-entry": { conversationStartId: 101 } },
      draftAgentId: "order-entry",
      draftSessionActive: true,
      pendingAgent: {
        id: "order-entry",
        conversationStartId: 101,
        boundSessionId: "ses_created",
      },
    };
    expect(resolveBoundExpertDraftNavigation({
      ...input,
      selectedSessionId: "ses_previous",
    })).toBe("ses_created");
    expect(resolveBoundExpertDraftNavigation({
      ...input,
      selectedSessionId: "ses_created",
    })).toBeNull();
  });

  test("does not let an older binding consume a newer draft for the same agent", () => {
    const contexts = {
      "order-entry": { conversationStartId: 202, label: "newer draft" },
    };
    const oldBinding = {
      contexts,
      agentId: "order-entry",
      conversationStartId: 101,
    };
    expect(matchesExpertDraftTransaction(oldBinding)).toBe(false);
    expect(consumeBoundExpertDraftContext(oldBinding)).toBe(contexts);
  });

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
      shouldKeepUnboundExpertDraft({
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
      shouldKeepUnboundExpertDraft({
        draftSessionActive: true,
        draftAgentId: "fulfillment-specialist",
        pendingDraftSource: "new-session",
        pendingAgentId: "fulfillment-specialist",
        selectedSessionAgentId: "fulfillment-specialist",
      }),
    ).toBe(true);
  });

  test("drops +新会话 draft when user opens another expert's real session", () => {
    expect(
      shouldKeepUnboundExpertDraft({
        draftSessionActive: true,
        draftAgentId: "fulfillment-specialist",
        pendingDraftSource: "new-session",
        pendingAgentId: "fulfillment-specialist",
        selectedSessionAgentId: "logistics-finance-specialist",
      }),
    ).toBe(false);
  });

  test("keeps a marketplace selection draft while the route still points at the previous expert", () => {
    expect(
      shouldKeepUnboundExpertDraft({
        draftSessionActive: true,
        draftAgentId: "senior-developer:senior-developer",
        pendingDraftSource: "agent-selection",
        pendingAgentId: "senior-developer:senior-developer",
        selectedSessionAgentId: "daily-assistant",
      }),
    ).toBe(true);
  });

  test("does not keep draft after first send binds a real session", () => {
    expect(
      shouldKeepUnboundExpertDraft({
        draftSessionActive: true,
        draftAgentId: "fulfillment-specialist",
        pendingDraftSource: "new-session",
        pendingAgentId: "fulfillment-specialist",
        pendingBoundSessionId: "ses_created",
        selectedSessionAgentId: "fulfillment-specialist",
      }),
    ).toBe(false);
  });
});
