import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpertDirectoryProjection } from "@onmyagent/types/server";
import {
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
  selectAgentIdForSession,
  selectExpertRail,
  selectExpertSessionIds,
} from "./expert-directory-page-model";
import { useExpertDirectoryStore } from "./expert-directory-store";

class MemoryStorage implements ExpertDirectoryCacheStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
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
});
