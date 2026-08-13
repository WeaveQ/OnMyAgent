import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ExpertDirectoryProjection } from "@onmyagent/types/server";
import {
  evictExpertDirectorySessions,
  readExpertDirectoryCache,
  writeExpertDirectoryCache,
  type ExpertDirectoryCacheStorage,
} from "./expert-directory-cache";
import {
  fetchExpertDirectory,
  readPersistedExpertDirectoryShadowOverride,
  resolveExpertDirectoryShadowEnabled,
} from "./expert-directory-query";
import {
  buildExpertDirectoryPageModel,
  buildExpertDirectoryShadowDiff,
  isExpertDirectoryReadyForIdentity,
  selectAgentIdForSession,
  selectExpertRail,
  selectExpertSessionIds,
  selectLiveDirectoryPayload,
} from "./expert-directory-page-model";
import { useExpertDirectoryStore } from "./expert-directory-store";

class MemoryStorage implements ExpertDirectoryCacheStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  seed(key: string, value: string): void { this.values.set(key, value); }
}

function projection(input: Partial<ExpertDirectoryProjection> = {}): ExpertDirectoryProjection {
  return {
    version: 1,
    schema: "onmyagent.expert-directory.v1",
    revision: 1,
    complete: true,
    state: "ok",
    failures: [],
    inventoryFingerprint: "fingerprint-1",
    records: [{
      agentId: "agent-a",
      packageName: "package-a",
      sessionIds: ["session-a"],
      runtimeDirectories: [],
      sessions: [{ sessionId: "session-a", runtimeMissing: false, declaredSkills: [], installedSkills: [], missingSkills: [] }],
      runtimeMissing: false,
      declaredSkills: [],
      installedSkills: [],
      missingSkills: [],
    }],
    tombstonedSessionIds: [],
    ...input,
  };
}

describe("expert directory cache/query/page model", () => {
  it("accepts monotonic revisions and same-fingerprint equal revision only", () => {
    const storage = new MemoryStorage();
    assert.equal(writeExpertDirectoryCache("workspace-a", projection(), storage), true);
    assert.equal(writeExpertDirectoryCache("workspace-a", projection({ revision: 0 }), storage), false);
    assert.equal(writeExpertDirectoryCache("workspace-a", projection({ revision: 1, inventoryFingerprint: "other" }), storage), false);
    assert.equal(writeExpertDirectoryCache("workspace-a", projection({ revision: 2 }), storage), true);
    assert.equal(readExpertDirectoryCache("workspace-a", storage)?.revision, 2);
    assert.equal(readExpertDirectoryCache("workspace-b", storage), null);
  });

  it("ignores corrupt cache and incomplete payloads", () => {
    const storage = new MemoryStorage();
    storage.seed("onmyagent:expert-directory:workspace-a", "{broken");
    assert.equal(readExpertDirectoryCache("workspace-a", storage), null);
    assert.equal(writeExpertDirectoryCache("workspace-a", projection({ complete: false }), storage), false);
  });

  it("fetch uses one canonical GET and retains complete cache on error/incomplete", async () => {
    const storage = new MemoryStorage();
    const calls: string[] = [];
    const client = {
      getExpertDirectory: async (workspaceId: string) => {
        calls.push(workspaceId);
        return projection();
      },
    };
    const first = await fetchExpertDirectory({ workspaceId: "workspace-a", client, storage });
    assert.equal(first.complete, true);
    await assert.rejects(fetchExpertDirectory({
      workspaceId: "workspace-a",
      storage,
      client: { getExpertDirectory: async () => { throw new Error("offline"); } },
    }));
    assert.deepEqual(readExpertDirectoryCache("workspace-a", storage)?.payload, first);
    const incomplete = await fetchExpertDirectory({
      workspaceId: "workspace-a",
      storage,
      client: { getExpertDirectory: async () => projection({ complete: false }) },
    });
    assert.equal(incomplete.complete, false);
    assert.deepEqual(calls, ["workspace-a"]);
  });

  it("page model precedence and selectors never synthesize empty ready state", () => {
    const complete = projection();
    assert.equal(buildExpertDirectoryPageModel({ workspaceError: "workspace offline", query: { isPending: true } }).state, "error");
    assert.equal(buildExpertDirectoryPageModel({ query: { isPending: true } }).state, "loading");
    assert.equal(buildExpertDirectoryPageModel({ query: { data: complete, isPending: true } }).state, "ready");
    assert.equal(buildExpertDirectoryPageModel({ query: { data: { ...complete, complete: false } } }).state, "incomplete");
    assert.equal(buildExpertDirectoryPageModel({ query: { data: { ...complete, complete: false }, lastComplete: complete } }).state, "incomplete");
    assert.equal(buildExpertDirectoryPageModel({ query: { error: new Error("offline"), lastComplete: complete } }).state, "error");
    assert.equal(buildExpertDirectoryPageModel({ query: { data: complete, error: new Error("offline") } }).state, "error");
    assert.deepEqual(selectExpertSessionIds(complete), ["session-a"]);
    assert.equal(selectAgentIdForSession(complete, "session-a"), "agent-a");
    assert.equal(selectExpertRail(complete)[0]?.agentId, "agent-a");
  });

  it("shadow diff exposes only counts and hashed IDs, with dev override", () => {
    const diff = buildExpertDirectoryShadowDiff({
      workspaceId: "workspace-a",
      legacy: [{ agentId: "agent-a", sessionIds: ["legacy-session"] }],
      projection: projection(),
    });
    assert.equal(JSON.stringify(diff).includes("legacy-session"), false);
    assert.equal(JSON.stringify(diff).includes("workspace-a"), false);
    assert.equal(diff.legacy.sessionCount, 1);
    assert.equal(resolveExpertDirectoryShadowEnabled({}), false);
    assert.equal(resolveExpertDirectoryShadowEnabled({ serverCapability: { read: true, shadow: true }, devOverride: false }), false);
    const storage = new MemoryStorage();
    storage.setItem("onmyagent:dev:expert-directory-shadow", "false");
    assert.equal(readPersistedExpertDirectoryShadowOverride({ storage, isDevelopment: true }), false);
    assert.equal(readPersistedExpertDirectoryShadowOverride({ storage, isDevelopment: false }), null);
  });

  it("derived Zustand store has status only, never a mutable server payload", () => {
    const store = useExpertDirectoryStore.getState();
    store.setStatus("workspace-a", "ready");
    assert.equal(useExpertDirectoryStore.getState().getStatus("workspace-a"), "ready");
    assert.equal("payload" in useExpertDirectoryStore.getState(), false);
  });

  it("getIdentity returns a cached snapshot so Zustand selectors do not loop", () => {
    const store = useExpertDirectoryStore.getState();
    store.setIdentity("workspace-snapshot", {
      sessionIds: new Set(["ses-a"]),
      agentIdBySessionId: new Map([["ses-a", "agent-a"]]),
    });
    const first = useExpertDirectoryStore.getState().getIdentity("workspace-snapshot");
    const second = useExpertDirectoryStore.getState().getIdentity("workspace-snapshot");
    assert.equal(first, second);
    store.upsertIdentity("workspace-snapshot", "ses-a", "agent-a");
    const afterNoop = useExpertDirectoryStore.getState().getIdentity("workspace-snapshot");
    assert.equal(afterNoop, first);
  });

  it("create overlay expires when the projection includes that session", () => {
    const store = useExpertDirectoryStore.getState();
    store.upsertIdentity("workspace-overlay", "ses-new", "agent-a");
    assert.equal(store.getIdentity("workspace-overlay").agentIdBySessionId.get("ses-new"), "agent-a");
    store.setIdentity("workspace-overlay", {
      sessionIds: new Set(["ses-new"]),
      agentIdBySessionId: new Map([["ses-new", "agent-a"]]),
    });
    const live = useExpertDirectoryStore.getState().getIdentity("workspace-overlay");
    assert.equal(live.agentIdBySessionId.get("ses-new"), "agent-a");
    assert.equal(
      (useExpertDirectoryStore.getState().overlayByWorkspace["workspace-overlay"] ?? []).length,
      0,
    );
  });

  it("keeps overlay live until the projection includes that session", () => {
    const store = useExpertDirectoryStore.getState();
    store.setIdentity("workspace-overlay-pending", {
      sessionIds: new Set(["ses-old"]),
      agentIdBySessionId: new Map([["ses-old", "agent-old"]]),
    });
    store.upsertIdentity("workspace-overlay-pending", "ses-new", "agent-a");
    const pending = store.getIdentity("workspace-overlay-pending");
    assert.equal(pending.sessionIds.has("ses-new"), true);
    assert.equal(pending.agentIdBySessionId.get("ses-new"), "agent-a");
    assert.equal(
      store.getProjectionIdentity("workspace-overlay-pending").sessionIds.has("ses-new"),
      false,
    );
    store.setIdentity("workspace-overlay-pending", {
      sessionIds: new Set(["ses-old"]),
      agentIdBySessionId: new Map([["ses-old", "agent-old"]]),
    });
    const stillPending = useExpertDirectoryStore.getState().getIdentity("workspace-overlay-pending");
    assert.equal(stillPending.sessionIds.has("ses-new"), true);
    assert.equal(stillPending.agentIdBySessionId.get("ses-new"), "agent-a");
  });

  it("expireOverlay drops create-time identity when create/delete ends", () => {
    const store = useExpertDirectoryStore.getState();
    store.upsertIdentity("workspace-overlay-expire", "ses-new", "agent-a");
    store.expireOverlay("workspace-overlay-expire", ["ses-new"]);
    assert.equal(
      useExpertDirectoryStore.getState().getIdentity("workspace-overlay-expire").sessionIds.has("ses-new"),
      false,
    );
  });

  it("does not treat agentId legacy plus all workspace sessions as expert SoT", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../domains/session/pages/use-expert-page-identity.ts"),
      "utf8",
    );
    assert.equal(source.includes('agentId: "legacy"'), false);
    assert.equal(source.includes("agentId: 'legacy'"), false);
    assert.equal(/sessionIds:\s*workspaceSessions/.test(source), false);
  });

  it("does not treat a stale lastComplete as live identity after a newer incomplete projection", () => {
    const lastComplete = projection({ revision: 5 });
    const incoming = projection({
      revision: 6,
      complete: false,
      records: [],
      tombstonedSessionIds: ["session-a"],
    });
    const live = selectLiveDirectoryPayload({ data: incoming, lastComplete });
    assert.deepEqual(selectExpertSessionIds(live), []);
    const page = buildExpertDirectoryPageModel({
      query: { data: incoming, lastComplete },
    });
    assert.equal(page.state, "incomplete");
    assert.deepEqual(selectExpertSessionIds(page.payload), []);
    assert.equal(isExpertDirectoryReadyForIdentity({
      state: page.state,
      payload: page.payload,
      data: incoming,
      lastComplete,
    }), false);
  });

  it("does not treat a stale lastComplete as live identity after a newer error projection", () => {
    const lastComplete = projection({ revision: 5 });
    const incoming = projection({
      revision: 6,
      complete: false,
      records: [],
      tombstonedSessionIds: ["session-a"],
    });
    const page = buildExpertDirectoryPageModel({
      query: { data: incoming, lastComplete, error: new Error("session_lookup_failed") },
    });
    assert.equal(page.state, "error");
    assert.deepEqual(selectExpertSessionIds(page.payload), []);
    assert.deepEqual(selectExpertSessionIds(selectLiveDirectoryPayload({ data: incoming, lastComplete })), []);
    assert.equal(isExpertDirectoryReadyForIdentity({
      state: page.state,
      payload: page.payload,
      data: incoming,
      lastComplete,
    }), false);
  });

  it("may keep lastComplete while pending when no newer projection arrived", () => {
    const lastComplete = projection({ revision: 5 });
    const page = buildExpertDirectoryPageModel({
      query: { isPending: true, lastComplete },
    });
    assert.equal(page.state, "ready");
    assert.deepEqual(selectExpertSessionIds(page.payload), ["session-a"]);
    const loading = buildExpertDirectoryPageModel({
      query: { isLoading: true, lastComplete },
    });
    assert.equal(loading.state, "ready");
    assert.deepEqual(selectExpertSessionIds(loading.payload), ["session-a"]);
    assert.equal(isExpertDirectoryReadyForIdentity({
      state: page.state,
      payload: page.payload,
      lastComplete,
    }), true);
  });

  it("does not paint lastComplete as ready when pending with a newer incomplete projection", () => {
    const lastComplete = projection({ revision: 5 });
    const incoming = projection({
      revision: 6,
      complete: false,
      records: [],
      tombstonedSessionIds: ["session-a"],
    });
    const page = buildExpertDirectoryPageModel({
      query: { data: incoming, lastComplete, isPending: true },
    });
    assert.equal(page.state, "incomplete");
    assert.deepEqual(selectExpertSessionIds(page.payload), []);
  });

  it("evictExpertDirectorySessions removes deleted ids from cache", () => {
    const storage = new MemoryStorage();
    const cached = projection({
      revision: 5,
      records: [
        {
          agentId: "agent-a",
          packageName: "package-a",
          sessionIds: ["session-a", "session-b"],
          runtimeDirectories: [],
          sessions: [
            { sessionId: "session-a", runtimeMissing: false, declaredSkills: [], installedSkills: [], missingSkills: [] },
            { sessionId: "session-b", runtimeMissing: false, declaredSkills: [], installedSkills: [], missingSkills: [] },
          ],
          runtimeMissing: false,
          declaredSkills: [],
          installedSkills: [],
          missingSkills: [],
        },
      ],
    });
    assert.equal(writeExpertDirectoryCache("workspace-a", cached, storage), true);
    assert.equal(evictExpertDirectorySessions("workspace-a", ["session-a"], storage), true);
    const next = readExpertDirectoryCache("workspace-a", storage);
    assert.ok(next);
    assert.deepEqual(selectExpertSessionIds(next.payload), ["session-b"]);
    assert.equal(next.payload.tombstonedSessionIds.includes("session-a"), true);
    assert.equal(evictExpertDirectorySessions("workspace-a", ["session-b"], storage), true);
    assert.equal(readExpertDirectoryCache("workspace-a", storage), null);
  });
});
