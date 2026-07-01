import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  getSessionScrollState,
  INITIAL_SESSION_SCROLL_STATE,
  SESSION_SCROLL_STORAGE_KEY,
  useSessionScrollStore,
} from "../src/react-app/domains/session/surface/scroll-store";

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: createLocalStorage() },
  });
  useSessionScrollStore.setState({ sessions: {} });
});

afterEach(() => {
  useSessionScrollStore.setState({ sessions: {} });
  Reflect.deleteProperty(globalThis, "window");
});

describe("session scroll store", () => {
  test("returns stable sticky-bottom fallback for missing sessions", () => {
    expect(getSessionScrollState({}, null)).toBe(INITIAL_SESSION_SCROLL_STATE);
    expect(getSessionScrollState({}, undefined)).toBe(INITIAL_SESSION_SCROLL_STATE);
    expect(getSessionScrollState({}, "missing")).toBe(INITIAL_SESSION_SCROLL_STATE);
  });

  test("normalizes manual scroll positions and persists by session", () => {
    useSessionScrollStore.getState().setManualScroll("session-a", 42.6, " msg-1 ");

    expect(useSessionScrollStore.getState().sessions["session-a"]).toEqual({
      mode: "manual",
      scrollTop: 43,
      topClippedMessageId: " msg-1 ",
    });
    expect(JSON.parse(window.localStorage.getItem(SESSION_SCROLL_STORAGE_KEY) ?? "{}"))
      .toEqual({
        "session-a": {
          mode: "manual",
          scrollTop: 43,
          topClippedMessageId: " msg-1 ",
        },
      });

    useSessionScrollStore.getState().setManualScroll("session-a", -10.2, null);
    expect(useSessionScrollStore.getState().sessions["session-a"]).toEqual({
      mode: "manual",
      scrollTop: 0,
      topClippedMessageId: null,
    });
  });

  test("keeps no-op updates referentially stable", () => {
    useSessionScrollStore.getState().setStickyBottom("session-a", "msg-1");
    const stickySessions = useSessionScrollStore.getState().sessions;
    useSessionScrollStore.getState().setStickyBottom("session-a", "msg-1");
    expect(useSessionScrollStore.getState().sessions).toBe(stickySessions);

    useSessionScrollStore.getState().setManualScroll("session-a", 12.1, "msg-2");
    const manualSessions = useSessionScrollStore.getState().sessions;
    useSessionScrollStore.getState().setManualScroll("session-a", 12, "msg-2");
    expect(useSessionScrollStore.getState().sessions).toBe(manualSessions);
  });

  test("updates top clipped message without changing scroll mode", () => {
    useSessionScrollStore.getState().setManualScroll("session-a", 20, null);
    useSessionScrollStore.getState().setTopClippedMessageId("session-a", "msg-3");

    expect(useSessionScrollStore.getState().sessions["session-a"]).toEqual({
      mode: "manual",
      scrollTop: 20,
      topClippedMessageId: "msg-3",
    });

    useSessionScrollStore.getState().setTopClippedMessageId("session-b", "msg-4");
    expect(useSessionScrollStore.getState().sessions["session-b"]).toEqual({
      mode: "stickyBottom",
      topClippedMessageId: "msg-4",
    });
  });

  test("ignores empty session ids", () => {
    const sessions = useSessionScrollStore.getState().sessions;
    useSessionScrollStore.getState().setStickyBottom(null, "msg-1");
    useSessionScrollStore.getState().setManualScroll(undefined, 10, "msg-2");
    useSessionScrollStore.getState().setTopClippedMessageId(null, "msg-3");
    expect(useSessionScrollStore.getState().sessions).toBe(sessions);
    expect(window.localStorage.getItem(SESSION_SCROLL_STORAGE_KEY)).toBe("{}");
  });
});
