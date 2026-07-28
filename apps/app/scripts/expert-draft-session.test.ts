import { describe, expect, test } from "bun:test";

import {
  resolveBoundExpertDraftSession,
  resolveReadyBoundExpertDraftSession,
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
});
