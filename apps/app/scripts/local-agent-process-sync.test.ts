import { describe, expect, test } from "bun:test";

import type {
  PersonalLocalAgent,
  PersonalLocalAgentProcessRecord,
} from "../src/app/lib/desktop";
import {
  messagesAlreadyContainRun,
  placeholderRunFromProcess,
  resolveBackgroundProcessAgentId,
} from "../src/react-app/domains/local-agents/host/personal-local-agent-page-helpers";
import type { ChatMessage } from "../src/react-app/domains/local-agents/messages/message-types";

function agent(id: string, provider: PersonalLocalAgent["provider"] = "custom"): PersonalLocalAgent {
  return {
    id,
    name: id === "workbuddy" ? "WorkBuddy" : id,
    provider,
    executablePath: "/bin/agent",
    model: null,
    customArgs: [],
    modelOptions: [],
    defaultModel: null,
    status: "online",
    version: null,
    error: null,
    lastCheckedAt: null,
  } as PersonalLocalAgent;
}

function processRecord(
  overrides: Partial<PersonalLocalAgentProcessRecord> & { runId: string },
): PersonalLocalAgentProcessRecord {
  return {
    pid: 4242,
    provider: "custom",
    backend: "custom",
    conversationId: "conv-1",
    agentType: "acp",
    command: "workbuddy --acp",
    startedAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("resolveBackgroundProcessAgentId", () => {
  test("prefers the registry agentId over provider", () => {
    expect(
      resolveBackgroundProcessAgentId(
        processRecord({ runId: "run-1", agentId: "workbuddy", provider: "custom" }),
        [agent("workbuddy"), agent("other")],
      ),
    ).toBe("workbuddy");
  });

  test("does not invent a Custom chat when several custom agents exist", () => {
    expect(
      resolveBackgroundProcessAgentId(
        processRecord({ runId: "run-1", provider: "custom" }),
        [agent("workbuddy"), agent("mimo")],
      ),
    ).toBeNull();
  });

  test("binds a unique custom agent when that is the only match", () => {
    expect(
      resolveBackgroundProcessAgentId(
        processRecord({ runId: "run-1", provider: "custom" }),
        [agent("workbuddy")],
      ),
    ).toBe("workbuddy");
  });
});

describe("placeholderRunFromProcess", () => {
  test("uses the catalog agent id instead of provider custom", () => {
    const run = placeholderRunFromProcess(
      processRecord({ runId: "run-1", agentId: "workbuddy" }),
      [agent("workbuddy"), agent("mimo")],
    );
    expect(run?.agentId).toBe("workbuddy");
    expect(run?.agentProvider).toBe("custom");
  });

  test("drops unattributed custom processes rather than creating a Custom row", () => {
    expect(
      placeholderRunFromProcess(
        processRecord({ runId: "run-1" }),
        [agent("workbuddy"), agent("mimo")],
      ),
    ).toBeNull();
  });
});

describe("messagesAlreadyContainRun", () => {
  test("detects the live run under a different chat key", () => {
    const messagesByAgent: Record<string, ChatMessage[]> = {
      "workbuddy::conv-1": [
        {
          id: "a1",
          role: "assistant",
          text: "running",
          createdAt: 1,
          run: { runId: "run-1", status: "running" } as ChatMessage["run"],
        },
      ],
    };
    expect(messagesAlreadyContainRun(messagesByAgent, "run-1")).toBe(true);
    expect(messagesAlreadyContainRun(messagesByAgent, "run-other")).toBe(false);
  });
});
