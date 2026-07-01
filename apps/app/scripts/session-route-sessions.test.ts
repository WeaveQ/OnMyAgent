import { describe, expect, test } from "bun:test";

import {
  findFirstSessionIdMatching,
  findWorkspaceIdOwningSession,
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
} from "../src/react-app/shell/session-route-sessions";
import type { SidebarSessionItem } from "../src/app/types";
import type { RouteWorkspace } from "../src/react-app/shell/session-route-model";

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

describe("session route sessions", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });

  test("normalizes raw session payloads and filters invalid items", () => {
    expect(toSidebarSessionItem({ id: "ses_1", title: "Title", directory: "/tmp/ws" })).toMatchObject({
      id: "ses_1",
      title: "Title",
      directory: "/tmp/ws",
    });
    expect(toSidebarSessionItem({ title: "missing id" })).toBeNull();
    expect(toSidebarSessionItems([{ id: "ses_1" }, null, { id: 123 }, { id: "ses_2" }]).map((item) => item.id))
      .toEqual(["ses_1", "ses_2"]);
  });

  test("inserts new sidebar sessions without duplicating existing ids", () => {
    const current = { ws_a: [session({ id: "ses_existing" })] };
    const inserted = insertSidebarSession({ current, workspaceId: "ws_a", session: { id: "ses_new", title: "New" } });

    expect(inserted.ws_a?.map((item) => item.id)).toEqual(["ses_new", "ses_existing"]);
    expect(insertSidebarSession({ current: inserted, workspaceId: "ws_a", session: { id: "ses_new" } }))
      .toBe(inserted);
  });

  test("keeps registered expert sessions even when their directory differs from workspace root", () => {
    localStorage.clear();
    localStorage.setItem(
      "onmyagent:expertSessionIds",
      JSON.stringify(["expert-outside-workspace"]),
    );

    const normalizeDirectoryPath = (path: string) => path.replace(/\/+$/, "");
    const assistantSessionIds = new Set<string>();

    expect(
      shouldKeepWorkspaceSessionItem({
        sessionId: "expert-outside-workspace",
        directory: "/tmp/builtin-experts/senior-developer",
        assistantSessionIds,
        normalizedWorkspaceRoot: "/Users/me/project",
        normalizeDirectoryPath,
      }),
    ).toBe(true);
    expect(
      shouldKeepWorkspaceSessionItem({
        sessionId: "plain-outside-workspace",
        directory: "/tmp/builtin-experts/senior-developer",
        assistantSessionIds,
        normalizedWorkspaceRoot: "/Users/me/project",
        normalizeDirectoryPath,
      }),
    ).toBe(false);

    localStorage.clear();
  });

  test("collects active session ids and reload blockers", () => {
    const sessions = [
      session({ id: " running ", title: "Running", status: "running" }),
      session({ id: "busy", slug: "Busy Slug", runStatus: "busy", title: "" }),
      session({ id: "done", status: "done" }),
    ];

    expect(getActiveSessionIds(sessions)).toEqual(["running", "busy"]);
    expect(getActiveReloadBlockingSessions({ ws_a: sessions })).toEqual([
      { id: "running", title: "Running" },
      { id: "busy", title: "Busy Slug" },
    ]);
  });

  test("preserves pending sessions until fetched or expired", () => {
    const pendingByWorkspaceId: PendingCreatedSessionMap = {
      ws_a: { pending_keep: 1_000, pending_expired: 1_000, fetched: 1_000 },
    };
    const merged = mergeFetchedSessionsWithPending({
      workspaceId: "ws_a",
      fetched: [session({ id: "fetched" })],
      current: [session({ id: "pending_keep" }), session({ id: "assistant_keep" }), session({ id: "fetched" })],
      pendingByWorkspaceId,
      explicitAssistantSessionIds: new Set(["assistant_keep"]),
      now: 20_000,
    });

    expect(merged.map((item) => item.id)).toEqual(["pending_keep", "assistant_keep", "fetched"]);
    expect(pendingByWorkspaceId.ws_a).toEqual({ pending_keep: 1_000, pending_expired: 1_000 });

    const expired = mergeFetchedSessionsWithPending({
      workspaceId: "ws_a",
      fetched: [],
      current: [session({ id: "pending_expired" })],
      pendingByWorkspaceId,
      explicitAssistantSessionIds: new Set(),
      now: 32_001,
    });

    expect(expired).toEqual([]);
    expect(pendingByWorkspaceId.ws_a).toEqual({ pending_keep: 1_000 });
  });

  test("merges fetched sessions for one workspace without touching others", () => {
    const next = mergeWorkspaceFetchedSessions({
      current: { ws_a: [session({ id: "old" })], ws_b: [session({ id: "other" })] },
      workspaceId: "ws_a",
      fetched: [session({ id: "new" })],
      merge: (fetched, current) => [...fetched, ...current],
    });

    expect(next.ws_a?.map((item) => item.id)).toEqual(["new", "old"]);
    expect(next.ws_b?.map((item) => item.id)).toEqual(["other"]);
  });

  test("resolves session ownership helpers", () => {
    const sessionsByWorkspaceId = {
      ws_a: [session({ id: "ses_a" })],
      ws_b: [session({ id: "ses_b" })],
    };

    expect(sessionListOwnsSession({ sessions: sessionsByWorkspaceId.ws_a, sessionId: "ses_a" })).toBe(true);
    expect(findWorkspaceIdOwningSession({ sessionsByWorkspaceId, sessionId: "ses_b" })).toBe("ws_b");
    expect(findWorkspaceIdOwningSession({ sessionsByWorkspaceId, sessionId: "ses_b", excludeWorkspaceId: "ws_b" }))
      .toBeNull();
    expect(sessionBelongsToAnotherWorkspace({ sessionsByWorkspaceId, selectedSessionId: "ses_b", selectedWorkspaceId: "ws_a" }))
      .toBe(true);
    expect(findFirstSessionIdMatching([session({ id: "a" }), session({ id: "expert_1" })], (id) => id.startsWith("expert")))
      .toBe("expert_1");
  });

  test("builds inspector, control, and palette entries", () => {
    const sessionsByWorkspaceId = {
      ws_a: [session({ id: "ses_a", title: "Alpha", directory: "/tmp/a", time: { created: 1, updated: 3 } })],
      ws_b: [session({ id: "ses_b", title: "Beta", time: { created: 2 } })],
    };

    expect(toInspectorSessionEntries(sessionsByWorkspaceId)).toEqual({
      ws_a: [{ id: "ses_a", title: "Alpha", directory: "/tmp/a" }],
      ws_b: [{ id: "ses_b", title: "Beta", directory: null }],
    });
    expect(toControlSessionEntries(sessionsByWorkspaceId).ws_a?.[0]).toEqual({
      id: "ses_a",
      title: "Alpha",
      time: { created: 1, updated: 3 },
    });
    expect(
      toPaletteSessionOptions({
        workspaces: [workspace({ id: "ws_a", displayName: " Workspace A " }), workspace({ id: "ws_b" })],
        sessionsByWorkspaceId,
        selectedWorkspaceId: "ws_b",
      }).map((item) => `${item.workspaceId}:${item.sessionId}:${item.isActive}`),
    ).toEqual(["ws_b:ses_b:true", "ws_a:ses_a:false"]);
  });

  test("computes max sequence from mixed event payloads", () => {
    expect(maxSequence([{ seq: 2 }, { seq: "5" }, null, { seq: Number.NaN }])).toBe(5);
  });
});
