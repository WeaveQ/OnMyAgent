import { describe, expect, test } from "bun:test";

import {
  chatKeyForActiveRun,
  mergeLocalAgentSidebarOrder,
  persistedChatPreferences,
  reconcileConversationSelection,
  sortLocalAgentsBySidebarOrder,
} from "../src/react-app/domains/local-agents/local-agent-page-model";

const conversations = ["conv-a", "conv-b"].map((id) => ({
  id,
  provider: "codex" as const,
  agentId: "codex",
  title: id,
  providerSessionId: null,
  resumeKey: null,
  workdir: null,
  createdAt: 1,
  updatedAt: 1,
  lastRunId: null,
  lastStatus: null,
  source: "studio-created",
}));

describe("active run chat key lookup", () => {
  test("binds a run to the chat key captured before await", () => {
    expect(
      chatKeyForActiveRun(
        { "codex::conv-a": "run-a", "codex::conv-b": "run-b" },
        "run-b",
      ),
    ).toBe("codex::conv-b");
    expect(chatKeyForActiveRun({ "codex::conv-a": "run-a" }, "run-missing")).toBeUndefined();
  });
});

describe("canonical local-agent chat state", () => {
  test("localStorage accepts preferences but discards legacy transcript and run snapshots", () => {
    expect(persistedChatPreferences({
      version: 1,
      selectedAgentId: "codex",
      selectedConversationIdByAgent: { codex: "conv-a", invalid: 42 },
      draftsByAgent: { "codex::conv-a": "draft" },
      messagesByAgent: { codex: [{ text: "stale" }] },
      activeRunIdByAgent: { codex: "stale-run" },
      healthResults: { codex: { status: "running" } },
      errorsByAgent: { codex: "stale error" },
    })).toEqual({
      version: 1,
      selectedAgentId: "codex",
      selectedConversationIdByAgent: { codex: "conv-a" },
      draftsByAgent: { "codex::conv-a": "draft" },
    });
  });

  test("stale selections move to the active conversation instead of surviving refresh", () => {
    expect(reconcileConversationSelection("gone", conversations, "conv-b")).toBe("conv-b");
    expect(reconcileConversationSelection("conv-a", conversations, "conv-b")).toBe("conv-a");
    expect(reconcileConversationSelection("gone", conversations, "also-gone")).toBe("conv-a");
    expect(reconcileConversationSelection("gone", [], null)).toBeUndefined();
  });
});

describe("local agent sidebar order", () => {
  test("merge keeps saved relative order and appends newcomers", () => {
    expect(
      mergeLocalAgentSidebarOrder(
        ["b", "a", "gone"],
        ["a", "c", "b"],
      ),
    ).toEqual(["b", "a", "c"]);
  });

  test("sort follows order ids; status is ignored", () => {
    const agents = [
      { id: "a", name: "Alpha", status: "offline" as const },
      { id: "b", name: "Beta", status: "online" as const },
      { id: "c", name: "Gamma", status: "online" as const },
    ];
    const ordered = sortLocalAgentsBySidebarOrder(agents, ["c", "a", "b"]);
    expect(ordered.map((agent) => agent.id)).toEqual(["c", "a", "b"]);

    // Same order even if status flips
    const flipped = agents.map((agent) => ({
      ...agent,
      status: agent.status === "online" ? ("offline" as const) : ("online" as const),
    }));
    expect(sortLocalAgentsBySidebarOrder(flipped, ["c", "a", "b"]).map((a) => a.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("unknown ids fall back to name order after known ones", () => {
    const agents = [
      { id: "z", name: "Zulu" },
      { id: "a", name: "Alpha" },
      { id: "m", name: "Mike" },
    ];
    expect(sortLocalAgentsBySidebarOrder(agents, ["m"]).map((a) => a.id)).toEqual([
      "m",
      "a",
      "z",
    ]);
  });
});
