import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  forgetWorkspaceMemory,
  readActiveWorkspaceId,
  readLastSessionFor,
  readWorkspaceOrderIds,
  writeActiveWorkspaceId,
  writeLastSessionFor,
  writeWorkspaceOrderIds,
} from "../src/react-app/shell/session-memory";

const ACTIVE_WORKSPACE_KEY = "onmyagent.react.activeWorkspace";
const SESSION_BY_WORKSPACE_KEY = "onmyagent.react.sessionByWorkspace";
const WORKSPACE_ORDER_KEY = "onmyagent.react.workspaceOrder";

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
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("session memory", () => {
  test("persists trimmed active workspace ids and removes empty values", () => {
    writeActiveWorkspaceId(" ws_1 ");
    expect(readActiveWorkspaceId()).toBe("ws_1");
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe("ws_1");

    writeActiveWorkspaceId("   ");
    expect(readActiveWorkspaceId()).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBeNull();
  });

  test("reads workspace order ids from valid string arrays only", () => {
    window.localStorage.setItem(WORKSPACE_ORDER_KEY, JSON.stringify([" ws_a ", "", 123, "ws_b"]));
    expect(readWorkspaceOrderIds()).toEqual(["ws_a", "ws_b"]);

    window.localStorage.setItem(WORKSPACE_ORDER_KEY, "not-json");
    expect(readWorkspaceOrderIds()).toEqual([]);
  });

  test("writes normalized workspace order ids and clears empty order", () => {
    writeWorkspaceOrderIds([" ws_a ", "", "ws_b"]);
    expect(JSON.parse(window.localStorage.getItem(WORKSPACE_ORDER_KEY) ?? "[]")).toEqual(["ws_a", "ws_b"]);

    writeWorkspaceOrderIds(["  "]);
    expect(window.localStorage.getItem(WORKSPACE_ORDER_KEY)).toBeNull();
  });

  test("persists and removes last session ids by workspace", () => {
    writeLastSessionFor(" ws_a ", " ses_1 ");
    writeLastSessionFor("ws_b", "ses_2");
    expect(readLastSessionFor("ws_a")).toBe("ses_1");
    expect(readLastSessionFor(" ws_b ")).toBe("ses_2");

    writeLastSessionFor("ws_a", null);
    expect(readLastSessionFor("ws_a")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SESSION_BY_WORKSPACE_KEY) ?? "{}"))
      .toEqual({ ws_b: "ses_2" });
  });

  test("ignores malformed last-session maps", () => {
    window.localStorage.setItem(SESSION_BY_WORKSPACE_KEY, JSON.stringify(["not", "a", "map"]));
    expect(readLastSessionFor("ws_a")).toBeNull();

    window.localStorage.setItem(SESSION_BY_WORKSPACE_KEY, JSON.stringify({ ws_a: "ses_1", ws_b: 42 }));
    expect(readLastSessionFor("ws_a")).toBe("ses_1");
    expect(readLastSessionFor("ws_b")).toBeNull();
  });

  test("forgets active workspace, last-session entry, and workspace order", () => {
    writeActiveWorkspaceId("ws_a");
    writeWorkspaceOrderIds(["ws_a", "ws_b"]);
    writeLastSessionFor("ws_a", "ses_a");
    writeLastSessionFor("ws_b", "ses_b");

    forgetWorkspaceMemory(" ws_a ");

    expect(readActiveWorkspaceId()).toBeNull();
    expect(readWorkspaceOrderIds()).toEqual(["ws_b"]);
    expect(readLastSessionFor("ws_a")).toBeNull();
    expect(readLastSessionFor("ws_b")).toBe("ses_b");
  });
});
