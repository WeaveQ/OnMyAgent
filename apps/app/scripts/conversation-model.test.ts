import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  addAssistantSession,
  addExpertSession,
} from "../src/react-app/domains/agents/agent-session-state";
import type { AgentRegistry } from "../src/react-app/domains/agents/agent-registry-types";
import {
  buildAgentConversationGroups,
  buildAgentStarterItems,
  buildAssistantConversationGroups,
  readAssistantPinnedSessionIds,
  writeAssistantPinnedSessionIds,
  writeCustomAgentIdForSession,
} from "../src/react-app/domains/session/components/shared-pages/conversation-model";
import { createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-default-registry";

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

const sessions = [
  { id: "assistant_old", title: "New session", time: { created: 10, updated: 20 } },
  { id: "assistant_new", title: "Daily check", time: { created: 30, updated: 50 } },
  { id: "expert_a_old", title: "Agent old", time: { created: 1, updated: 2 } },
  { id: "expert_a_new", title: "Agent new", time: { created: 3, updated: 9 } },
  { id: "expert_missing", title: "Missing Agent", time: { created: 4, updated: 7 } },
  { id: "normal", title: "Normal", time: { created: 100, updated: 100 } },
];

const registry = {
  version: 1,
  updatedAt: "2026-06-24T00:00:00.000Z",
  avatars: [
    {
      id: "avatar_blue",
      style: "preset",
      label: "Blue",
      initials: "BA",
      background: "#123456",
      foreground: "#ffffff",
      accent: "#abcdef",
    },
  ],
  templates: [],
  agents: [
    {
      id: "agent_a",
      name: "Agent Alpha",
      description: "  Helps with alpha tasks  ",
      quote: "",
      tone: "专业",
      avatarStyle: "preset",
      avatarOptionId: "avatar_blue",
      customAvatarDataUrl: null,
      modelProvider: "openai",
      model: "gpt-4o",
      enabledToolIds: [],
      defaultWorkspace: "",
      skillIds: [],
      preferredName: "",
      preferredLanguage: "",
      userNote: "",
      userBackground: "",
      sourceTemplateId: null,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    },
  ],
  skills: [],
} satisfies AgentRegistry;

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: createLocalStorage() },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("conversation model assistant pinned sessions", () => {
  test("reads, dedupes, and clears pinned session ids by workspace", () => {
    window.localStorage.setItem(
      "onmyagent.assistantPinnedSessions.v1",
      JSON.stringify({ ws_1: ["ses_1", 42, "ses_2"], ws_2: ["other"] }),
    );

    expect(readAssistantPinnedSessionIds("ws_1")).toEqual(["ses_1", "ses_2"]);

    writeAssistantPinnedSessionIds("ws_1", ["ses_2", "ses_2", "ses_3"]);
    expect(readAssistantPinnedSessionIds("ws_1")).toEqual(["ses_2", "ses_3"]);
    expect(readAssistantPinnedSessionIds("ws_2")).toEqual(["other"]);

    writeAssistantPinnedSessionIds("ws_1", []);
    expect(readAssistantPinnedSessionIds("ws_1")).toEqual([]);
    expect(readAssistantPinnedSessionIds("ws_2")).toEqual(["other"]);
  });
});

describe("conversation model assistant groups", () => {
  test("builds sorted assistant groups and uses generated fallback titles", () => {
    addAssistantSession("assistant_old");
    addAssistantSession("assistant_new");

    const groups = buildAssistantConversationGroups(
      sessions,
      new Map([["assistant_old", "The user asked: summarize release notes!"]]),
    );

    expect(groups.map((group) => group.latestSession.id)).toEqual(["assistant_new", "assistant_old"]);
    expect(groups[0].description).toBe("Daily check");
    expect(groups[1].description).toBe("asked summarize release notes");
    expect(groups.every((group) => group.agentId === null)).toBe(true);
  });
});

describe("conversation model agent groups", () => {
  test("groups expert sessions by agent id and tracks the latest session", () => {
    addExpertSession("expert_a_old");
    addExpertSession("expert_a_new");
    addExpertSession("expert_missing");
    writeCustomAgentIdForSession("expert_a_old", "agent_a");
    writeCustomAgentIdForSession("expert_a_new", "agent_a");
    writeCustomAgentIdForSession("expert_missing", "missing_agent");

    const groups = buildAgentConversationGroups(sessions, registry);

    expect(groups.map((group) => group.key)).toEqual(["agent:agent_a", "agent:missing_agent"]);
    expect(groups[0].name).toBe("Agent Alpha");
    expect(groups[0].description).toBe("Helps with alpha tasks");
    expect(groups[0].latestSession.id).toBe("expert_a_new");
    expect(groups[0].sessions.map((session) => session.id)).toEqual(["expert_a_old", "expert_a_new"]);
    expect(groups[1].name).toBe("Missing Agent");
    expect(groups[1].description).toBe("该智能体的配置尚未加载或已被删除");
  });

  test("builds default starter items without requiring persisted expert sessions", () => {
    const starters = buildAgentStarterItems(createDefaultAgentRegistry());

    expect(starters.map((item) => item.agentId)).toEqual(["daily-assistant"]);
    // Name comes from i18n; locale under bun tests may be en or zh.
    expect(["日常助手", "Daily assistant"]).toContain(starters[0]?.name);
  });
});
