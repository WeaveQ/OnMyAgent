import { describe, expect, test } from "bun:test";

import {
  bindPendingAgentToSession,
  registerCreatedSessionStartIntent,
  resolvePendingAgentForPrompt,
} from "../src/react-app/shell/session-route-agent-context";
import type { PendingAgentContext } from "../src/react-app/domains/agents/pending-agent-store";

function pendingAgent(input: Partial<PendingAgentContext> = {}): PendingAgentContext {
  return {
    id: "agent_1",
    name: "Agent One",
    systemPrompt: "Be useful",
    tools: { write: false, edit: true },
    ...input,
  };
}

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
      agentRuntime: undefined,
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
      agentRuntime: undefined,
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

  test("keeps the dedicated agent runtime on existing and restored sessions", () => {
    const boundAgent = pendingAgent({
      boundSessionId: "ses_bound",
      runtime: "browser-use-agent",
    });

    expect(
      resolvePendingAgentForPrompt({
        currentAgent: boundAgent,
        createdSession: false,
        draftRuntime: undefined,
        persistedRuntime: undefined,
        sessionId: "ses_bound",
      }).agentRuntime,
    ).toBe("browser-use-agent");

    expect(
      resolvePendingAgentForPrompt({
        currentAgent: null,
        createdSession: false,
        draftRuntime: undefined,
        persistedRuntime: "browser-use-agent",
        sessionId: "ses_restored",
      }).agentRuntime,
    ).toBe("browser-use-agent");
  });

  test("prefers the expert page runtime without leaking another bound agent", () => {
    expect(
      resolvePendingAgentForPrompt({
        currentAgent: pendingAgent({
          boundSessionId: "ses_other",
          runtime: "browser-use-agent",
        }),
        createdSession: false,
        draftRuntime: "browser-use-agent",
        persistedRuntime: undefined,
        sessionId: "ses_current",
      }).agentRuntime,
    ).toBe("browser-use-agent");

    expect(
      resolvePendingAgentForPrompt({
        currentAgent: pendingAgent({
          boundSessionId: "ses_other",
          runtime: "browser-use-agent",
        }),
        createdSession: false,
        draftRuntime: undefined,
        persistedRuntime: undefined,
        sessionId: "ses_current",
      }).agentRuntime,
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

  test("does not register a session without an explicit start intent", () => {
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
});
