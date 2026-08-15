import { describe, expect, test } from "bun:test";

import {
  beginSessionRouteColdEnter,
  resetColdPathCounters,
} from "../src/react-app/shell/session-route/cold-path-budget";
import {
  collectWorkspaceSessionItemsWithStatus,
  findFirstSessionIdMatching,
  findWorkspaceIdOwningSession,
  filterExpertCreationEphemeralSessionsByWorkspace,
  getActiveReloadBlockingSessions,
  getActiveSessionIds,
  insertSidebarSession,
  maxSequence,
  mergeFetchedSessionsWithPending,
  mergeWorkspaceFetchedSessions,
  sessionBelongsToAnotherWorkspace,
  sessionListOwnsSession,
  shouldKeepWorkspaceSessionItem,
  toControlSessionEntries,
  toInspectorSessionEntries,
  toPaletteSessionOptions,
  toSidebarSessionItem,
  toSidebarSessionItems,
  type PendingCreatedSessionMap,
} from "../src/react-app/shell/session-route/sessions";
import type { SidebarSessionItem } from "../src/app/types";
import type { RouteWorkspace } from "../src/react-app/shell/session-route/model";
import {
  clearExpertCreationEphemeralSessions,
  registerExpertCreationEphemeralSession,
} from "../src/react-app/domains/agents/expert-creation-ephemeral-sessions";
import { writeSessionAgentSnapshot } from "../src/react-app/domains/agents/agent-registry-store";
import { EXPERT_CREATION_COACH_AGENT_ID } from "../src/react-app/domains/agents/agent-builtin";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function session(input: Partial<SidebarSessionItem> & { id: string }): SidebarSessionItem {
  return {
    id: input.id,
    title: input.title ?? input.id,
    slug: input.slug ?? null,
    status: input.status,
    state: input.state,
    runStatus: input.runStatus,
    parentID: input.parentID ?? null,
    time: input.time,
    directory: input.directory ?? null,
  };
}

function workspace(input: Partial<RouteWorkspace> & { id: string }): RouteWorkspace {
  return {
    id: input.id,
    name: input.name ?? input.id,
    path: input.path ?? `/tmp/${input.id}`,
    preset: "local",
    workspaceType: "local",
    displayNameResolved: input.displayNameResolved ?? input.name ?? input.id,
    displayName: input.displayName,
  };
}

describe("session route aggregate loader", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });

  test("normalizes raw session payloads and filters invalid items", () => {
    expect(toSidebarSessionItem({ id: "ses_1", title: "Title", directory: "/tmp/ws" })).toMatchObject({
      id: "ses_1", title: "Title", directory: "/tmp/ws",
    });
    expect(toSidebarSessionItem({ title: "missing id" })).toBeNull();
    expect(toSidebarSessionItems([{ id: "ses_1" }, null, { id: 123 }, { id: "ses_2" }]).map((item) => item.id))
      .toEqual(["ses_1", "ses_2"]);
  });

  test("uses exactly one workspace aggregate request and preserves partial rows", async () => {
    let calls = 0;
    const result = await collectWorkspaceSessionItemsWithStatus({
      client: {
        listSessions: async (_workspaceId, options) => {
          calls += 1;
          expect(options?.scope).toBe("workspace");
          return {
            scope: "workspace" as const,
            complete: false,
            failures: [{ source: "expert-runtime", key: "hash", index: 1, code: "directory_read_failed" }],
            items: [
              { id: "root-session", directory: "/tmp/workspace" },
              { id: "expert-session", directory: "/tmp/expert" },
            ],
          };
        },
      },
      workspaceId: "workspace-a",
      workspaceRoot: "/tmp/workspace",
      isRemoteOnMyAgentWorkspace: false,
      assistantSessionRecords: [],
      normalizeDirectoryPath: (path) => path,
    });
    expect(calls).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.items.map((item) => item.id)).toEqual(["root-session", "expert-session"]);
  });

  test("does not fan out assistant directories", async () => {
    let calls = 0;
    const result = await collectWorkspaceSessionItemsWithStatus({
      client: {
        listSessions: async () => {
          calls += 1;
          return { scope: "workspace" as const, complete: true, failures: [], items: [{ id: "assistant", directory: "/assistant" }] };
        },
      },
      workspaceId: "workspace-a",
      workspaceRoot: "/root",
      isRemoteOnMyAgentWorkspace: false,
      assistantSessionRecords: [{ sessionId: "assistant", directory: "/assistant" }],
      normalizeDirectoryPath: (path) => path,
    });
    expect(calls).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["assistant"]);
  });

  test("skips a second listSessions on the same cold enter", async () => {
    resetColdPathCounters();
    beginSessionRouteColdEnter("workspace-a");
    let calls = 0;
    const input = {
      client: {
        listSessions: async () => {
          calls += 1;
          return {
            scope: "workspace" as const,
            complete: true,
            failures: [],
            items: [{ id: "ses_1", directory: "/tmp" }],
          };
        },
      },
      workspaceId: "workspace-a",
      workspaceRoot: "/tmp",
      isRemoteOnMyAgentWorkspace: false,
      assistantSessionRecords: [],
      normalizeDirectoryPath: (path: string) => path,
    };
    const first = await collectWorkspaceSessionItemsWithStatus(input);
    const second = await collectWorkspaceSessionItemsWithStatus(input);
    expect(calls).toBe(1);
    expect(first.items.map((item) => item.id)).toEqual(["ses_1"]);
    expect(second.skippedByColdPathBudget).toBe(true);
    expect(second.complete).toBe(false);
    expect(second.items).toEqual([]);
    resetColdPathCounters();
  });

  test("preserves pending sessions until aggregate includes them", () => {
    const pendingByWorkspaceId: PendingCreatedSessionMap = {
      ws_a: { pending_keep: 1_000, pending_expired: 1_000 },
    };
    const merged = mergeFetchedSessionsWithPending({
      workspaceId: "ws_a",
      fetched: [session({ id: "fetched" })],
      current: [session({ id: "pending_keep" }), session({ id: "fetched" })],
      pendingByWorkspaceId,
      explicitAssistantSessionIds: new Set(),
      now: 20_000,
    });
    expect(merged.map((item) => item.id)).toEqual(["pending_keep", "fetched"]);
    expect(pendingByWorkspaceId.ws_a).toEqual({ pending_keep: 1_000, pending_expired: 1_000 });
  });

  test("merges one workspace without touching another and keeps warming rows", () => {
    const next = mergeWorkspaceFetchedSessions({
      current: { ws_a: [session({ id: "old" })], ws_b: [session({ id: "other" })] },
      workspaceId: "ws_a",
      fetched: [session({ id: "new" })],
      merge: (fetched, current) => [...fetched, ...current],
    });
    expect(next.ws_a?.map((item) => item.id)).toEqual(["new", "old"]);
    expect(next.ws_b?.map((item) => item.id)).toEqual(["other"]);
    const warm = mergeWorkspaceFetchedSessions({
      current: { ws_a: [session({ id: "existing" })] },
      workspaceId: "ws_a",
      fetched: [],
      merge: () => [],
    });
    expect(warm.ws_a?.map((item) => item.id)).toEqual(["existing"]);
  });

  test("filters creation ephemerals and keeps explicit expert helper behavior", () => {
    localStorage.clear();
    registerExpertCreationEphemeralSession("preview-session");
    expect(filterExpertCreationEphemeralSessionsByWorkspace({ ws_a: [session({ id: "preview-session" }), session({ id: "normal" })] }).ws_a?.map((item) => item.id))
      .toEqual(["normal"]);
    clearExpertCreationEphemeralSessions();
    writeSessionAgentSnapshot("legacy-coach", {
      id: EXPERT_CREATION_COACH_AGENT_ID,
      name: "Expert coach",
      description: "Creates experts",
      avatar: { avatarStyle: "robot", avatarOptionId: "robot-1", customAvatarDataUrl: null, avatarUrl: null, avatarBackground: null },
      systemPrompt: "Help create an expert.",
    });
    expect(shouldKeepWorkspaceSessionItem({
      sessionId: "legacy-coach",
      directory: "/tmp/root",
      assistantSessionIds: new Set(),
      normalizedWorkspaceRoot: "/tmp/root",
      normalizeDirectoryPath: (path) => path,
    })).toBe(false);
  });

  test("keeps ownership and projection helper output stable", () => {
    const items = [session({ id: "a", time: { updated: 4 } }), session({ id: "b" })];
    expect(sessionListOwnsSession({ sessions: items, sessionId: "a" })).toBe(true);
    expect(findWorkspaceIdOwningSession({ sessionsByWorkspaceId: { ws_a: items }, sessionId: "a" })).toBe("ws_a");
    expect(sessionBelongsToAnotherWorkspace({ selectedSessionId: "a", selectedWorkspaceId: "ws_b", sessionsByWorkspaceId: { ws_a: items } })).toBe(true);
    expect(findFirstSessionIdMatching(items, (id) => id === "b")).toBe("b");
    expect(toInspectorSessionEntries({ ws_a: items }).ws_a).toHaveLength(2);
    expect(toControlSessionEntries({ ws_a: items }).ws_a).toHaveLength(2);
    expect(toPaletteSessionOptions({ workspaces: [workspace({ id: "ws_a" })], sessionsByWorkspaceId: { ws_a: items }, selectedWorkspaceId: "ws_a" })).toHaveLength(2);
    expect(maxSequence([{ seq: 2 }, { seq: "4" }, {}])).toBe(4);
    expect(getActiveSessionIds([session({ id: "busy", runStatus: "busy" }), session({ id: "done" })])).toEqual(["busy"]);
    expect(getActiveReloadBlockingSessions({ ws_a: [session({ id: "busy", runStatus: "busy" })] })).toHaveLength(1);
  });
});
