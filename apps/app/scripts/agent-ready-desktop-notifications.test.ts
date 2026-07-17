import { describe, expect, test } from "bun:test";

import {
  buildAgentReadyNotificationBody,
  shouldNotifyAgentReadyTransition,
} from "../src/react-app/domains/shell-feedback/agent-ready-desktop-notifications";

describe("agent ready desktop notifications", () => {
  test("only notifies when leaving a busy state for idle", () => {
    expect(shouldNotifyAgentReadyTransition("responding", "idle")).toBe(true);
    expect(shouldNotifyAgentReadyTransition("thinking", "idle")).toBe(true);
    expect(shouldNotifyAgentReadyTransition("idle", "idle")).toBe(false);
    expect(shouldNotifyAgentReadyTransition(undefined, "idle")).toBe(false);
    expect(shouldNotifyAgentReadyTransition("responding", "thinking")).toBe(
      false,
    );
  });

  test("builds body with optional user/assistant snippets", () => {
    expect(
      buildAgentReadyNotificationBody({
        sessionTitle: "t",
        userSnippet: "hello\nworld",
        assistantSnippet: "line1\nline2",
        fallbackBody: "fallback",
      }),
    ).toBe("User: hello world\nAssistant: line2");
    expect(
      buildAgentReadyNotificationBody({
        sessionTitle: "t",
        userSnippet: null,
        assistantSnippet: null,
        fallbackBody: "fallback",
      }),
    ).toBe("fallback");
  });
});
