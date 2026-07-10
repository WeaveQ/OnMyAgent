import { afterEach, describe, expect, test } from "bun:test";

import {
  buildPendingAgentFromRecord,
  readCustomAgentIdForSession,
  readCustomAgentSessionEntries,
  readSessionAgentSnapshot,
  useAgentRegistryStore,
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "../src/react-app/domains/agents/agent-registry-store";
import type { AgentRegistry } from "../src/react-app/domains/agents/agent-registry-types";

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

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});

const registry = {
  version: 1,
  updatedAt: "2026-06-24T00:00:00.000Z",
  avatars: [
    {
      id: "robot-helper",
      style: "机器人",
      label: "Helper",
      initials: "H",
      background: "#d9eefc",
      foreground: "#174767",
      accent: "#4a94d2",
    },
  ],
  templates: [
    {
      id: "tpl-1",
      name: "研究员",
      description: "Research helper",
      quote: "拆解复杂问题",
      tone: "专业",
      avatarStyle: "机器人",
      avatarOptionId: "robot-helper",
      modelProvider: "OpenAI",
      model: "GPT-4.1",
      enabledToolIds: ["code"],
      skillIds: [],
      preferredName: "Lee",
      preferredLanguage: "中文",
      userNote: "先给结论",
      userBackground: "AI builder",
      showInOverview: true,
      showInWizard: true,
    },
  ],
  agents: [],
  skills: [],
} satisfies AgentRegistry;

afterEach(() => {
  localStorage.clear();
  useAgentRegistryStore.getState().setRegistry(null);
});

describe("shared agent registry store", () => {
  test("persists registry snapshots for session-domain restore flows", () => {
    useAgentRegistryStore.getState().setRegistry(registry);

    expect(useAgentRegistryStore.getState().getRegistry()).toEqual(registry);
    expect(JSON.parse(localStorage.getItem("onmyagent:agentRegistryCache") ?? "null")).toEqual(registry);

    useAgentRegistryStore.getState().setRegistry(null);

    expect(useAgentRegistryStore.getState().getRegistry()).toBeNull();
    expect(localStorage.getItem("onmyagent:agentRegistryCache")).toBeNull();
  });

  test("reads and writes custom agent ids by session", () => {
    expect(readCustomAgentIdForSession("ses-1")).toBeNull();

    writeCustomAgentIdForSession("ses-1", "agent-1");
    writeCustomAgentIdForSession("ses-2", "agent-2");

    expect(readCustomAgentIdForSession("ses-1")).toBe("agent-1");
    expect(readCustomAgentIdForSession("ses-2")).toBe("agent-2");

    writeCustomAgentIdForSession("ses-1", null);

    expect(readCustomAgentIdForSession("ses-1")).toBeNull();
    expect(readCustomAgentIdForSession("ses-2")).toBe("agent-2");
  });

  test("reads all custom agent session entries for restored expert lists", () => {
    writeCustomAgentIdForSession("ses-1", "agent-1");
    writeCustomAgentIdForSession("ses-2", "agent-2");

    expect(readCustomAgentSessionEntries()).toEqual([
      { sessionId: "ses-1", agentId: "agent-1" },
      { sessionId: "ses-2", agentId: "agent-2" },
    ]);
  });

  test("reads and writes custom agent snapshots by session", () => {
    const pending = buildPendingAgentFromRecord(registry.templates[0]!, registry);
    if (!pending) throw new Error("expected pending agent");

    expect(readSessionAgentSnapshot("ses-1")).toBeNull();

    writeSessionAgentSnapshot("ses-1", pending);

    const snapshot = readSessionAgentSnapshot("ses-1");
    expect(snapshot).toMatchObject({
      id: "tpl-1",
      name: "研究员",
      description: "Research helper",
      avatarBackground: "#d9eefc",
      systemPrompt: pending.systemPrompt,
    });
    expect(typeof snapshot?.avatarUrl).toBe("string");

    writeSessionAgentSnapshot("ses-1", null);

    expect(readSessionAgentSnapshot("ses-1")).toBeNull();
  });

  test("builds pending agent context from registry records", () => {
    const pending = buildPendingAgentFromRecord(registry.templates[0]!, registry);

    expect(pending).toMatchObject({
      id: "tpl-1",
      name: "研究员",
      model: { providerID: "openai", modelID: "gpt-4.1" },
      avatar: { avatarBackground: "#d9eefc" },
    });
    expect(pending?.systemPrompt).toContain("你现在的身份是：研究员");
    expect(pending?.tools?.bash).toBeUndefined();
  });
});
