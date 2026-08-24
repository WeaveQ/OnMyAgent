import { describe, expect, test } from "bun:test";

import {
  buildAssistantBatchSections,
  buildAssistantListModel,
  isAssistantBatchOperationCurrent,
  reconcileAssistantBatchSelection,
  resolveAssistantBatchSelection,
  runAssistantBatchOperation,
  toggleAssistantBatchSelection,
} from "../src/react-app/domains/session/sidebar/assistant-list-model";
import type { AgentConversationGroup } from "../src/react-app/domains/session/sidebar/conversation-model";

function group(id: string, updated: number): AgentConversationGroup {
  const session = {
    id,
    title: id,
    time: { created: updated, updated },
  };
  return {
    key: id,
    name: id,
    description: `Task ${id}`,
    preview: id,
    agentId: null,
    avatarUrl: null,
    avatarBackground: "#000000",
    sessions: [session],
    latestSession: session,
  };
}

describe("buildAssistantBatchSections", () => {
  test("uses the complete pinned, recent, and space projections without duplicates", () => {
    const pinned = group("pinned", 10);
    const pinnedSpace = group("pinned-space", 20);
    const recent = group("recent", 30);
    const space = group("space", 40);
    const pinnedDirectory = "/tmp/pinned-space";
    const directory = "/tmp/space";
    const model = buildAssistantListModel({
      groups: [pinned, pinnedSpace, recent, space],
      globalPins: [
        { kind: "session", id: pinned.latestSession.id },
        { kind: "folder", id: pinnedDirectory },
      ],
      spaceLocalPinsByDirectory: {},
      spaceFolderOrder: [pinnedDirectory, directory],
      workspaceBySessionId: new Map([
        [pinnedSpace.latestSession.id, { directory: pinnedDirectory }],
        [space.latestSession.id, { directory }],
      ]),
    });

    expect(buildAssistantBatchSections(model)).toEqual({
      pinned: [
        { sessionId: "pinned", title: "Task pinned" },
        { sessionId: "pinned-space", title: "Task pinned-space" },
      ],
      recent: [{ sessionId: "recent", title: "Task recent" }],
      spaces: [{ sessionId: "space", title: "Task space" }],
    });
  });
});

describe("assistant batch selection", () => {
  test("reports unchecked, indeterminate, and checked states", () => {
    const ids = ["one", "two", "three"];

    expect(resolveAssistantBatchSelection(ids, new Set())).toEqual({
      checked: false,
      indeterminate: false,
      selectedCount: 0,
      totalCount: 3,
    });
    expect(resolveAssistantBatchSelection(ids, new Set(["one"]))).toEqual({
      checked: false,
      indeterminate: true,
      selectedCount: 1,
      totalCount: 3,
    });
    expect(resolveAssistantBatchSelection(ids, new Set(ids))).toEqual({
      checked: true,
      indeterminate: false,
      selectedCount: 3,
      totalCount: 3,
    });
  });

  test("selects a partial target completely and clears a fully selected target", () => {
    const partial = toggleAssistantBatchSelection(
      new Set(["one", "outside"]),
      ["one", "two"],
    );
    expect([...partial]).toEqual(["one", "outside", "two"]);

    const cleared = toggleAssistantBatchSelection(partial, ["one", "two"]);
    expect([...cleared]).toEqual(["outside"]);
  });

  test("drops selections that no longer exist after an action or category change", () => {
    const reconciled = reconcileAssistantBatchSelection(
      new Set(["keep", "removed"]),
      ["keep", "new"],
    );
    expect([...reconciled]).toEqual(["keep"]);
  });
});

describe("runAssistantBatchOperation", () => {
  test("continues after a failure and reports successful and failed ids", async () => {
    const visited: string[] = [];
    const result = await runAssistantBatchOperation(
      ["one", "two", "three"],
      async (sessionId) => {
        visited.push(sessionId);
        if (sessionId === "two") throw new Error("blocked");
      },
    );

    expect(visited).toEqual(["one", "two", "three"]);
    expect(result.succeededIds).toEqual(["one", "three"]);
    expect(result.failures.map((failure) => failure.sessionId)).toEqual(["two"]);
    expect(result.failures[0]?.error).toEqual(new Error("blocked"));
  });
});

test("scope generations reject stale A → B → A operation completions", () => {
  const operationGeneration = 4;
  const returnedToSameScopeGeneration = 6;

  expect(
    isAssistantBatchOperationCurrent(
      operationGeneration,
      returnedToSameScopeGeneration,
    ),
  ).toBe(false);
  expect(isAssistantBatchOperationCurrent(6, 6)).toBe(true);
});
