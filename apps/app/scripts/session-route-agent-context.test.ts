import { describe, expect, test } from "bun:test";

import {
  bindPendingAgentToSession,
  registerCreatedSessionAgentCategory,
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

  test("registers created sessions in assistant and expert categories independently", () => {
    const assistantSessions: string[] = [];
    const expertSessions: string[] = [];

    registerCreatedSessionAgentCategory({
      addAssistantSession: (sessionId) => assistantSessions.push(sessionId),
      addExpertSession: (sessionId) => expertSessions.push(sessionId),
      consumePendingAssistantTask: () => true,
      consumePendingExpertTask: () => false,
      sessionId: "ses_assistant",
    });
    registerCreatedSessionAgentCategory({
      addAssistantSession: (sessionId) => assistantSessions.push(sessionId),
      addExpertSession: (sessionId) => expertSessions.push(sessionId),
      consumePendingAssistantTask: () => false,
      consumePendingExpertTask: () => true,
      sessionId: "ses_expert",
    });

    expect(assistantSessions).toEqual(["ses_assistant"]);
    expect(expertSessions).toEqual(["ses_expert"]);
  });

  test("allows a created session to consume both pending category flags", () => {
    const assistantSessions: string[] = [];
    const expertSessions: string[] = [];

    registerCreatedSessionAgentCategory({
      addAssistantSession: (sessionId) => assistantSessions.push(sessionId),
      addExpertSession: (sessionId) => expertSessions.push(sessionId),
      consumePendingAssistantTask: () => true,
      consumePendingExpertTask: () => true,
      sessionId: "ses_both",
    });

    expect(assistantSessions).toEqual(["ses_both"]);
    expect(expertSessions).toEqual(["ses_both"]);
  });
});
