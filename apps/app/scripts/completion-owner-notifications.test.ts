import { describe, expect, test } from "bun:test";

import {
  resolveCompletionOwnerKind,
  shouldEmitAgentReadyDesktopNotification,
  shouldSuppressAgentReadyForOwner,
} from "../src/react-app/domains/shell-feedback";

describe("completion owner notifications", () => {
  test("suppresses Agent-ready for automation-owned sessions", () => {
    const automationOwnedSessionIds = new Set(["ses_auto_1"]);
    expect(
      shouldSuppressAgentReadyForOwner({
        sessionId: "ses_auto_1",
        automationOwnedSessionIds,
      }),
    ).toBe(true);
    expect(
      shouldSuppressAgentReadyForOwner({
        sessionId: "ses_chat_1",
        automationOwnedSessionIds,
      }),
    ).toBe(false);
    expect(
      shouldSuppressAgentReadyForOwner({
        sessionId: "  ",
        automationOwnedSessionIds,
      }),
    ).toBe(false);
  });

  test("Agent-ready emit requires busy→idle and non-automation owner", () => {
    const automationOwnedSessionIds = new Set(["ses_auto_1"]);
    expect(
      shouldEmitAgentReadyDesktopNotification({
        previous: "responding",
        next: "idle",
        sessionId: "ses_chat_1",
        automationOwnedSessionIds,
      }),
    ).toBe(true);
    expect(
      shouldEmitAgentReadyDesktopNotification({
        previous: "responding",
        next: "idle",
        sessionId: "ses_auto_1",
        automationOwnedSessionIds,
      }),
    ).toBe(false);
    expect(
      shouldEmitAgentReadyDesktopNotification({
        previous: "idle",
        next: "idle",
        sessionId: "ses_chat_1",
        automationOwnedSessionIds,
      }),
    ).toBe(false);
    expect(
      shouldEmitAgentReadyDesktopNotification({
        previous: undefined,
        next: "idle",
        sessionId: "ses_chat_1",
        automationOwnedSessionIds,
      }),
    ).toBe(false);
  });

  test("resolves completion owner kind", () => {
    const automationOwnedSessionIds = new Set(["ses_auto_1"]);
    expect(
      resolveCompletionOwnerKind({
        sessionId: "ses_auto_1",
        automationOwnedSessionIds,
      }),
    ).toBe("automation");
    expect(
      resolveCompletionOwnerKind({
        sessionId: "ses_chat_1",
        automationOwnedSessionIds,
      }),
    ).toBe("interactive");
    expect(
      resolveCompletionOwnerKind({
        sessionId: "",
        automationOwnedSessionIds,
      }),
    ).toBe("unknown");
  });
});
