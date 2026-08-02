import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearExpertSessionSelectionCache,
  readExpertSessionSelection,
  resolveExpertPrefetchSessionId,
  resolveExpertSessionSelection,
  writeExpertSessionSelection,
} from "../src/react-app/domains/session/sidebar/expert-session-selection-memory";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const STORAGE_KEY = "onmyagent.expertSessionSelection.v1";

beforeEach(() => {
  clearExpertSessionSelectionCache();
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
});

afterEach(() => {
  clearExpertSessionSelectionCache();
  localStorage.removeItem(STORAGE_KEY);
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("expert session selection memory", () => {
  test("stores and reads by workspace + agent (session id, not index)", () => {
    writeExpertSessionSelection("ws-1", "agent-a", "session-2");
    writeExpertSessionSelection("ws-1", "agent-b", "session-x");
    writeExpertSessionSelection("ws-2", "agent-a", "session-other");

    expect(readExpertSessionSelection("ws-1", "agent-a")).toBe("session-2");
    expect(readExpertSessionSelection("ws-1", "agent-b")).toBe("session-x");
    expect(readExpertSessionSelection("ws-2", "agent-a")).toBe("session-other");
    expect(readExpertSessionSelection("ws-1", "missing")).toBeNull();
  });

  test("resolve prefers remembered session id when still present", () => {
    expect(
      resolveExpertSessionSelection({
        rememberedSessionId: "s2",
        sessionIds: ["s1", "s2", "s3"],
        orderIds: ["s3", "s1", "s2"],
      }),
    ).toBe("s2");
  });

  test("resolve falls back to first orderIds tab then first sessionIds", () => {
    expect(
      resolveExpertSessionSelection({
        rememberedSessionId: "gone",
        sessionIds: ["s1", "s2"],
        orderIds: ["draft:x", "s2", "s1"],
      }),
    ).toBe("s2");

    expect(
      resolveExpertSessionSelection({
        rememberedSessionId: null,
        sessionIds: ["s1", "s2"],
        orderIds: [],
      }),
    ).toBe("s1");
  });

  test("ignores draft ids for memory write and resolve", () => {
    writeExpertSessionSelection("ws-1", "agent-a", "draft:ws");
    expect(readExpertSessionSelection("ws-1", "agent-a")).toBeNull();

    expect(
      resolveExpertSessionSelection({
        rememberedSessionId: "draft:ws",
        sessionIds: ["draft:ws", "s1"],
        orderIds: ["draft:ws", "s1"],
      }),
    ).toBe("s1");
  });

  test("prefetch target prefers remembered session over latest fallback", () => {
    writeExpertSessionSelection("ws-1", "agent-a", "session-old");
    expect(
      resolveExpertPrefetchSessionId({
        workspaceId: "ws-1",
        agentId: "agent-a",
        sessionIds: ["session-new", "session-old"],
        fallbackSessionId: "session-new",
      }),
    ).toBe("session-old");
  });

  test("prefetch falls back when memory is empty", () => {
    expect(
      resolveExpertPrefetchSessionId({
        workspaceId: "ws-1",
        agentId: "agent-a",
        sessionIds: ["session-new"],
        fallbackSessionId: "session-new",
      }),
    ).toBe("session-new");
  });

  test("in-memory cache survives after write without re-read thrash", () => {
    writeExpertSessionSelection("ws-1", "agent-a", "session-1");
    expect(readExpertSessionSelection("ws-1", "agent-a")).toBe("session-1");
    // Mutate storage under the cache — read still returns cached value until clear.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "ws-1:agent-a": "session-hijacked" }),
    );
    expect(readExpertSessionSelection("ws-1", "agent-a")).toBe("session-1");
    clearExpertSessionSelectionCache();
    expect(readExpertSessionSelection("ws-1", "agent-a")).toBe("session-hijacked");
  });
});
