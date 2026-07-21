import { beforeEach, describe, expect, test } from "bun:test";

import { useExpertUnreadStore } from "../src/react-app/domains/session/status/expert-unread-store";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";

beforeEach(() => {
  useExpertUnreadStore.setState({
    byWorkspace: {},
    sessionUnreadByWorkspace: {},
    focused: null,
  });
  useSessionActivityStore.setState({
    recordsByWorkspaceId: {},
    statusesByWorkspaceId: {},
  });
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("onmyagent.expert-unread.v1");
    localStorage.removeItem("onmyagent.expert-unread.v2");
  }
});

describe("expert unread store", () => {
  test("assistant activity marks expert unread until markRead", () => {
    const store = useExpertUnreadStore.getState();
    store.noteAssistantActivity("ws_1", "agent_a", {
      at: 1_000,
      sessionId: "ses_1",
      runKey: "run_1",
    });
    expect(store.isUnread("ws_1", "agent_a")).toBe(true);
    expect(store.getUnreadCount("ws_1", "agent_a")).toBe(1);

    useExpertUnreadStore.getState().markRead("ws_1", "agent_a", 2_000);
    expect(useExpertUnreadStore.getState().isUnread("ws_1", "agent_a")).toBe(
      false,
    );
    expect(useExpertUnreadStore.getState().getUnreadCount("ws_1", "agent_a")).toBe(
      0,
    );
  });

  test("focused expert does not accumulate unread from stream activity", () => {
    useExpertUnreadStore.getState().setFocusedAgent("ws_1", "agent_a");
    useExpertUnreadStore.getState().noteAssistantActivity("ws_1", "agent_a", {
      at: 5_000,
      sessionId: "ses_1",
      runKey: "run_1",
    });
    expect(useExpertUnreadStore.getState().isUnread("ws_1", "agent_a")).toBe(
      false,
    );
  });

  test("one reply / stream parts share the same run and stay at count 1", () => {
    useExpertUnreadStore.getState().noteAssistantActivity("ws_1", "agent_b", {
      at: 10_000,
      sessionId: "ses_1",
      runKey: "run_1",
    });
    useExpertUnreadStore.getState().noteAssistantActivity("ws_1", "agent_b", {
      at: 20_000,
      sessionId: "ses_1",
      runKey: "run_1",
    });
    useExpertUnreadStore.getState().noteAssistantActivity("ws_1", "agent_b", {
      at: 30_000,
      sessionId: "ses_1",
      runKey: "run_1",
    });
    expect(useExpertUnreadStore.getState().getUnreadCount("ws_1", "agent_b")).toBe(
      1,
    );
  });

  test("new run on same session increments while still unread", () => {
    useExpertUnreadStore.getState().noteAssistantActivity("ws_1", "agent_b", {
      at: 10_000,
      sessionId: "ses_1",
      runKey: "run_1",
    });
    expect(useExpertUnreadStore.getState().getUnreadCount("ws_1", "agent_b")).toBe(
      1,
    );

    useExpertUnreadStore.getState().noteAssistantActivity("ws_1", "agent_b", {
      at: 40_000,
      sessionId: "ses_1",
      runKey: "run_2",
    });
    expect(useExpertUnreadStore.getState().getUnreadCount("ws_1", "agent_b")).toBe(
      2,
    );
  });

  test("setFocusedAgent marks read when switching to expert", () => {
    useExpertUnreadStore.getState().noteAssistantActivity("ws_1", "agent_c", {
      at: 1_000,
      sessionId: "ses_1",
      runKey: "run_1",
    });
    expect(useExpertUnreadStore.getState().isUnread("ws_1", "agent_c")).toBe(
      true,
    );
    useExpertUnreadStore.getState().setFocusedAgent("ws_1", "agent_c");
    expect(useExpertUnreadStore.getState().isUnread("ws_1", "agent_c")).toBe(
      false,
    );
  });

  test("manual markUnread shows badge even while focused and tags session chip", () => {
    useExpertUnreadStore.getState().setFocusedAgent("ws_1", "agent_d");
    useExpertUnreadStore.getState().markUnread("ws_1", "agent_d", {
      at: 9_000,
      sessionId: "ses_chip",
    });
    const state = useExpertUnreadStore.getState();
    expect(state.isUnread("ws_1", "agent_d")).toBe(true);
    expect(state.hasUnreadRecord("ws_1", "agent_d")).toBe(true);
    expect(state.isSessionUnread("ws_1", "ses_chip")).toBe(true);
    expect(state.getUnreadCount("ws_1", "agent_d")).toBeGreaterThanOrEqual(1);

    state.markRead("ws_1", "agent_d", 10_000);
    const after = useExpertUnreadStore.getState();
    expect(after.isUnread("ws_1", "agent_d")).toBe(false);
    expect(after.isSessionUnread("ws_1", "ses_chip")).toBe(false);
  });

  test("markSessionRead clears only the session chip unread", () => {
    useExpertUnreadStore.getState().markUnread("ws_1", "agent_e", {
      sessionId: "ses_a",
    });
    useExpertUnreadStore.getState().markUnread("ws_1", "agent_e", {
      sessionId: "ses_b",
    });
    useExpertUnreadStore.getState().markSessionRead("ws_1", "ses_a");
    const state = useExpertUnreadStore.getState();
    expect(state.isSessionUnread("ws_1", "ses_a")).toBe(false);
    expect(state.isSessionUnread("ws_1", "ses_b")).toBe(true);
    expect(state.hasUnreadRecord("ws_1", "agent_e")).toBe(true);
  });
});
