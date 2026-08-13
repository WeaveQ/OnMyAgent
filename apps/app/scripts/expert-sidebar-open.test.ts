import { describe, expect, test } from "bun:test";

import {
  resolveExpertSidebarOpen,
  shouldExitDraftForExpertSidebarTarget,
} from "../src/react-app/domains/session/pages/expert-conversation-model";

describe("expert sidebar open target", () => {
  test("opens the remembered ready tab on the first click", () => {
    expect(resolveExpertSidebarOpen({
      hintSessionId: "session-new",
      rememberedSessionId: "session-old",
      orderIds: ["session-new", "session-old"],
      readySessionIds: ["session-new", "session-old"],
      selectedSessionId: "session-new",
    })).toEqual({ sessionId: "session-old", shouldOpen: true });
  });

  test("only treats a selected ready target as an already-open session", () => {
    expect(resolveExpertSidebarOpen({
      hintSessionId: "session-old",
      rememberedSessionId: "session-old",
      orderIds: ["session-old"],
      readySessionIds: ["session-old"],
      selectedSessionId: "session-old",
    })).toEqual({ sessionId: "session-old", shouldOpen: false });

    expect(resolveExpertSidebarOpen({
      hintSessionId: "session-old",
      rememberedSessionId: "session-old",
      orderIds: [],
      readySessionIds: [],
      selectedSessionId: "session-old",
    })).toEqual({ sessionId: "session-old", shouldOpen: true });
  });

  test("an explicit expert click exits any overlaid draft", () => {
    const target = resolveExpertSidebarOpen({
      hintSessionId: "session-real",
      rememberedSessionId: "session-real",
      orderIds: ["session-real"],
      readySessionIds: ["session-real"],
      selectedSessionId: "session-real",
    });

    expect(target.shouldOpen).toBe(false);
    expect(shouldExitDraftForExpertSidebarTarget({
      draftAgentId: "expert-a",
      draftSessionActive: true,
      targetAgentId: "expert-a",
    })).toBe(true);
    expect(shouldExitDraftForExpertSidebarTarget({
      draftAgentId: "expert-b",
      draftSessionActive: true,
      targetAgentId: "expert-a",
    })).toBe(true);
  });
});
