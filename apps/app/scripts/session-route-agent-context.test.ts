import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  bindPendingAgentToSession,
  inheritPendingAgentFromSession,
  registerCreatedSessionStartIntent,
  resolvePendingAgentForPrompt,
} from "../src/react-app/shell/session-route/agent-context";
import {
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "../src/react-app/domains/agents";
import type { PendingAgentContext } from "../src/react-app/domains/agents/pending-agent-store";

function pendingAgent(input: Partial<PendingAgentContext> = {}): PendingAgentContext {
  return {
    id: "agent_1",
    name: "Agent One",
    description: "desc",
    systemPrompt: "Be useful",
    avatar: {
      avatarStyle: "robot",
      avatarOptionId: "test",
      customAvatarDataUrl: null,
      avatarUrl: null,
      avatarBackground: "#111",
    },
    tools: { write: false, edit: true },
    ...input,
  };
}

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
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createLocalStorage(),
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("session route agent context", () => {
  test("uses current pending agent as snapshot only for newly created sessions", () => {
    const agent = pendingAgent();

    expect(
      resolvePendingAgentForPrompt({
        currentAgent: agent,
        createdSession: true,
        sessionId: "ses_1",
      }),
    ).toEqual({
      pendingAgentSnapshot: agent,
      agentToolAccess: agent.tools,
    });

    expect(
      resolvePendingAgentForPrompt({
        currentAgent: agent,
        createdSession: false,
        sessionId: "ses_1",
      }),
    ).toEqual({
      pendingAgentSnapshot: null,
      agentToolAccess: agent.tools,
    });
  });

  test("only exposes pending agent tools to the bound session", () => {
    const boundAgent = pendingAgent({ boundSessionId: "ses_bound" });

    expect(
      resolvePendingAgentForPrompt({
        currentAgent: boundAgent,
        createdSession: false,
        sessionId: "ses_bound",
      }).agentToolAccess,
    ).toEqual(boundAgent.tools);

    expect(
      resolvePendingAgentForPrompt({
        currentAgent: boundAgent,
        createdSession: false,
        sessionId: "ses_other",
      }).agentToolAccess,
    ).toBeUndefined();
  });

  test("binds pending agents without mutating the original snapshot", () => {
    const agent = pendingAgent();
    const bound = bindPendingAgentToSession({ agent, sessionId: "ses_1" });

    expect(bound).toEqual({ ...agent, boundSessionId: "ses_1" });
    expect(agent.boundSessionId).toBeUndefined();
  });

  test("registers a created session in exactly the category carried by its start intent", () => {
    const assistantSessions: string[] = [];
    const expertSessions: string[] = [];
    const assistantCategories: Array<{ sessionId: string; category: string }> = [];

    registerCreatedSessionStartIntent({
      addAssistantSession: (sessionId) => assistantSessions.push(sessionId),
      addExpertSession: (sessionId) => expertSessions.push(sessionId),
      intent: { mode: "assistant", assistantCategory: "code" },
      sessionId: "ses_assistant",
      writeAssistantSessionCategory: (sessionId, category) =>
        assistantCategories.push({ sessionId, category }),
    });
    registerCreatedSessionStartIntent({
      addAssistantSession: (sessionId) => assistantSessions.push(sessionId),
      addExpertSession: (sessionId) => expertSessions.push(sessionId),
      intent: { mode: "expert" },
      sessionId: "ses_expert",
      writeAssistantSessionCategory: (sessionId, category) =>
        assistantCategories.push({ sessionId, category }),
    });

    expect(assistantSessions).toEqual(["ses_assistant"]);
    expect(expertSessions).toEqual(["ses_expert"]);
    expect(assistantCategories).toEqual([
      { sessionId: "ses_assistant", category: "code" },
    ]);
  });

  test("does not register a session without an explicit start intent or pageMode", () => {
    const assistantSessions: string[] = [];
    const expertSessions: string[] = [];

    registerCreatedSessionStartIntent({
      addAssistantSession: (sessionId) => assistantSessions.push(sessionId),
      addExpertSession: (sessionId) => expertSessions.push(sessionId),
      sessionId: "ses_both",
      writeAssistantSessionCategory: () => {
        throw new Error("a session without an intent must not receive a category");
      },
    });

    expect(assistantSessions).toEqual([]);
    expect(expertSessions).toEqual([]);
  });

  test("falls back to pageMode when start intent is missing", () => {
    const assistantSessions: string[] = [];
    const categories: string[] = [];

    registerCreatedSessionStartIntent({
      addAssistantSession: (sessionId) => assistantSessions.push(sessionId),
      addExpertSession: () => {},
      pageMode: "assistant",
      sessionId: "ses_force_new",
      writeAssistantSessionCategory: (_id, category) => categories.push(category),
    });

    expect(assistantSessions).toEqual(["ses_force_new"]);
    expect(categories).toEqual(["office"]);
  });

  test("inherits expert binding from prior session when pending store is empty", () => {
    const source = pendingAgent({
      id: "expert_capacity",
      name: "运力调配作业",
      systemPrompt: "You are a logistics expert.",
    });
    writeCustomAgentIdForSession("ses_old", source.id);
    writeSessionAgentSnapshot("ses_old", source);

    const inherited = inheritPendingAgentFromSession("ses_old");
    expect(inherited?.id).toBe("expert_capacity");
    expect(inherited?.name).toBe("运力调配作业");
    expect(inherited?.systemPrompt).toBe("You are a logistics expert.");

    expect(
      resolvePendingAgentForPrompt({
        currentAgent: null,
        createdSession: true,
        sessionId: "ses_new",
        inheritFromSessionId: "ses_old",
      }).pendingAgentSnapshot?.id,
    ).toBe("expert_capacity");

    // Live pending agent still wins over inheritance.
    expect(
      resolvePendingAgentForPrompt({
        currentAgent: pendingAgent({ id: "expert_other", name: "Other" }),
        createdSession: true,
        sessionId: "ses_new",
        inheritFromSessionId: "ses_old",
      }).pendingAgentSnapshot?.id,
    ).toBe("expert_other");

    // Existing session (not create) never inherits.
    expect(
      resolvePendingAgentForPrompt({
        currentAgent: null,
        createdSession: false,
        sessionId: "ses_new",
        inheritFromSessionId: "ses_old",
      }).pendingAgentSnapshot,
    ).toBeNull();
  });

  test("inherits id-only when snapshot is missing but agent id mapping exists", () => {
    writeCustomAgentIdForSession("ses_id_only", "agent_bare");
    const inherited = inheritPendingAgentFromSession("ses_id_only");
    expect(inherited?.id).toBe("agent_bare");
    expect(inherited?.systemPrompt).toBe("");
  });
});
