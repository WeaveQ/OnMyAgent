import { describe, expect, test } from "bun:test";

import { resolveExpertSidebarOpen } from "../src/react-app/domains/session/pages/expert-conversation-model";

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
});
