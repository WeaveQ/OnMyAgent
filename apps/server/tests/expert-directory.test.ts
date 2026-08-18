import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import {
  buildExpertDirectory,
  clearExpertDirectoryCache,
  healExpertDirectory,
} from "../src/services/expert-directory.js";
import { deleteSessionOrigin, listSessionOrigins, upsertSessionOrigin } from "../src/services/session-origins.js";
import { getExpertLifecycleEventsSnapshot, resetExpertLifecycleEventsForTest } from "../src/services/expert-lifecycle-events.js";

const roots: string[] = [];

afterEach(async () => {
  clearExpertDirectoryCache();
  resetExpertLifecycleEventsForTest();
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function workspace(id = "expert-directory-test"): Promise<WorkspaceInfo> {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-expert-directory-"));
  roots.push(root);
  const path = join(root, "repo");
  await mkdir(path, { recursive: true });
  return { id, name: id, path, preset: "starter", workspaceType: "local" };
}

async function markerRoot(workspace: WorkspaceInfo, agent: string, session: string) {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-runtime-"));
  roots.push(runtimeRoot);
  const segment = createHash("sha256")
    .update(`${workspace.id}\0${workspace.path}`)
    .digest("hex")
    .slice(0, 16);
  const directory = join(runtimeRoot, segment, agent, "legacy-key");
  await mkdir(directory, { recursive: true });
  return { runtimeRoot, directory, session };
}

async function writeMarker(directory: string, workspaceId: string, input: Record<string, unknown>) {
  await writeFile(join(directory, "onmyagent-session.json"), JSON.stringify({
    kind: "expert-session",
    workspaceId,
    ...input,
  }));
}

describe("expert directory projection", () => {
  test("marker-only workspace is complete and dry-run heal plans an origin", async () => {
    const current = await workspace();
    const marker = await markerRoot(current, "expert-a", "session-real");
    await writeMarker(marker.directory, current.id, {
      isolationVersion: 3,
      agentId: "expert-a",
      packageName: "expert-package",
      sessionId: marker.session,
      declaredSkills: ["skill-a"],
      installedSkills: ["skill-a"],
      missingSkills: [],
    });
    const lookup = async () => [{ id: marker.session, directory: await realpath(marker.directory) }];

    const projection = await buildExpertDirectory(current, { runtimeRoot: marker.runtimeRoot, readSessions: lookup });
    expect(projection.complete).toBe(true);
    expect(projection.records[0]).toMatchObject({ agentId: "expert-a", packageName: "expert-package", sessionIds: [marker.session] });
    expect(getExpertLifecycleEventsSnapshot().events.filter((event) => event.kind === "directory_fetch")).toHaveLength(2);
    expect((await healExpertDirectory(current, {}, { runtimeRoot: marker.runtimeRoot, readSessions: lookup })).actions)
      .toMatchObject([{ sessionId: marker.session, kind: "write_origin", result: "planned" }]);
    expect(getExpertLifecycleEventsSnapshot().events.filter((event) => event.kind === "heal").map((event) => event.outcome))
      .toEqual(["started", "succeeded"]);
  });

  test("assistant-origin sessions are not projected from leftover expert markers", async () => {
    const current = await workspace("assistant-origin-skip");
    const marker = await markerRoot(current, "greeting", "session-home");
    await writeMarker(marker.directory, current.id, {
      isolationVersion: 3,
      agentId: "greeting-expert",
      packageName: "greeting",
      sessionId: marker.session,
      declaredSkills: [],
      installedSkills: [],
      missingSkills: [],
    });
    await upsertSessionOrigin(current, marker.session, {
      kind: "assistant",
      directory: marker.directory,
    });
    const projection = await buildExpertDirectory(current, {
      runtimeRoot: marker.runtimeRoot,
      readSessions: async () => [{ id: marker.session, directory: marker.directory }],
    });
    expect(projection.records.flatMap((record) => record.sessionIds)).not.toContain(marker.session);
  });

  test("origins-only projection stays complete and marks runtime missing", async () => {
    const current = await workspace("origins-only");
    await upsertSessionOrigin(current, "session-origin", {
      kind: "expert",
      agentId: "expert-a",
      packageName: "expert-package",
      directory: "/external/runtime/session-origin",
    });
    const projection = await buildExpertDirectory(current, {
      runtimeRoot: join(tmpdir(), "onmyagent-no-runtime-root"),
      readSessions: async () => [{ id: "session-origin", directory: "/external/runtime/session-origin" }],
    });
    expect(projection.complete).toBe(true);
    expect(projection.records[0]).toMatchObject({ runtimeMissing: true, sessionIds: ["session-origin"] });
  });

  test("legacy expert origins without packageName stay complete via agentId derivation", async () => {
    const current = await workspace("legacy-no-package");
    // Bypass upsert validation by writing origins file with agentId-only expert records
    // (historical writes before packageName was required).
    const originsPath = join(current.path, ".opencode", "onmyagent", "session-origins.json");
    await mkdir(join(current.path, ".opencode", "onmyagent"), { recursive: true });
    await writeFile(originsPath, JSON.stringify({
      version: 2,
      revision: 1,
      records: [
        {
          workspaceId: current.id,
          sessionId: "session-legacy-a",
          kind: "expert",
          agentId: "fleet-management-specialist:fleet-management-specialist",
          directory: "/external/runtime/session-legacy-a",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          workspaceId: current.id,
          sessionId: "session-legacy-b",
          kind: "expert",
          agentId: "smb-finance:smb-finance",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      tombstones: [],
    }));
    const projection = await buildExpertDirectory(current, {
      runtimeRoot: join(tmpdir(), "onmyagent-no-runtime-root-legacy"),
      readSessions: async () => [
        { id: "session-legacy-a", directory: "/external/runtime/session-legacy-a" },
        { id: "session-legacy-b" },
      ],
    });
    expect(projection.complete).toBe(true);
    expect(projection.failures).toEqual([]);
    expect(projection.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: "fleet-management-specialist:fleet-management-specialist",
        packageName: "fleet-management-specialist",
        sessionIds: ["session-legacy-a"],
        runtimeMissing: true,
      }),
      expect.objectContaining({
        agentId: "smb-finance:smb-finance",
        packageName: "smb-finance",
        sessionIds: ["session-legacy-b"],
        runtimeMissing: true,
      }),
    ]));
  });

  test("durable ghost origin is marked session-missing without renderer pruning", async () => {
    const current = await workspace("ghost-origin");
    await upsertSessionOrigin(current, "session-ghost", {
      kind: "expert",
      agentId: "expert-a",
      packageName: "expert-package",
      directory: "/external/runtime/session-ghost",
    });
    const projection = await buildExpertDirectory(current, {
      runtimeRoot: join(tmpdir(), "onmyagent-no-runtime-root"),
      readSessions: async () => [],
    });
    expect(projection.complete).toBe(true);
    expect(projection.records[0]).toMatchObject({
      runtimeMissing: true,
      sessionMissing: true,
      sessionIds: ["session-ghost"],
    });
  });

  test("legacy marker binds to OpenCode directory, never marker sessionKey", async () => {
    const current = await workspace("legacy-binding");
    const marker = await markerRoot(current, "legacy-agent", "real-session-id");
    await writeMarker(marker.directory, current.id, {
      isolationVersion: 2,
      agent: "legacy-agent",
      sessionKey: "timestamp-key-not-an-id",
    });
    const lookup = async () => [{ id: marker.session, directory: await realpath(marker.directory) }];
    const result = await healExpertDirectory(current, {}, { runtimeRoot: marker.runtimeRoot, readSessions: lookup });
    expect(result.actions).toContainEqual(expect.objectContaining({
      sessionId: marker.session,
      agentId: "legacy-agent",
      kind: "write_origin",
    }));
    expect(result.actions.some((action) => action.sessionId === "timestamp-key-not-an-id")).toBe(false);
  });

  test("legacy identity reports unresolved and ambiguous directory matches", async () => {
    const current = await workspace("legacy-failures");
    const marker = await markerRoot(current, "legacy-agent", "legacy-key");
    await writeMarker(marker.directory, current.id, { isolationVersion: 2, agent: "legacy-agent", sessionKey: "legacy-key" });
    const unresolved = await healExpertDirectory(current, {}, {
      runtimeRoot: marker.runtimeRoot,
      readSessions: async () => [{ id: "other-session", directory: "/other/directory" }],
    });
    expect(unresolved.actions).toMatchObject([{ code: "legacy_identity_unresolved", result: "skipped" }]);
    clearExpertDirectoryCache();
    const ambiguous = await healExpertDirectory(current, {}, {
      runtimeRoot: marker.runtimeRoot,
      readSessions: async () => [
        { id: "first", directory: await realpath(marker.directory) },
        { id: "second", directory: await realpath(marker.directory) },
      ],
    });
    expect(ambiguous.actions).toMatchObject([{ code: "legacy_identity_ambiguous", result: "skipped" }]);
  });

  test("cache is exact-key and isolated by workspace", async () => {
    const first = await workspace("cache-a");
    const second = await workspace("cache-b");
    const runtimeRoot = await mkdtemp(join(tmpdir(), "onmyagent-cache-runtime-"));
    roots.push(runtimeRoot);
    let lookupCalls = 0;
    const firstResult = await buildExpertDirectory(first, {
      runtimeRoot,
      readSessions: async () => {
        lookupCalls += 1;
        return [];
      },
    });
    expect(firstResult.complete).toBe(true);
    const cached = await buildExpertDirectory(first, {
      runtimeRoot,
      readSessions: async () => {
        lookupCalls += 1;
        return [];
      },
    });
    expect(cached).toBe(firstResult);
    expect(lookupCalls).toBe(2);
    const incomplete = await buildExpertDirectory(first, {
      runtimeRoot,
      readSessions: async () => { throw new Error("OpenCode unavailable"); },
    });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.lastComplete).toMatchObject({ revision: firstResult.revision });
    const other = await buildExpertDirectory(second, {
      runtimeRoot,
      readSessions: async () => { throw new Error("workspace must not reuse another cache"); },
    });
    expect(other.complete).toBe(false);
    expect(other.lastComplete).toBeUndefined();
  });

  test("a v3 marker wins an origin conflict and heal repairs it", async () => {
    const current = await workspace("conflict");
    const first = await markerRoot(current, "expert-a", "same-session");
    await writeMarker(first.directory, current.id, {
      isolationVersion: 3, agentId: "expert-a", packageName: "pkg-a", sessionId: "same-session",
      declaredSkills: [], installedSkills: [], missingSkills: [],
    });
    await upsertSessionOrigin(current, "same-session", {
      kind: "expert", agentId: "expert-b", packageName: "pkg-b", directory: first.directory,
    });
    const result = await buildExpertDirectory(current, {
      runtimeRoot: first.runtimeRoot,
      readSessions: async () => [{ id: "same-session", directory: first.directory }],
    });
    expect(result.complete).toBe(true);
    expect(result.failures).toMatchObject([{ code: "marker_identity_conflict" }]);
    expect(result.failures[0]?.key).not.toContain(first.directory);
    const healed = await healExpertDirectory(current, {
      apply: true,
      expectedRevision: result.revision,
    }, {
      runtimeRoot: first.runtimeRoot,
      readSessions: async () => [{ id: "same-session", directory: first.directory }],
    });
    expect(healed.complete).toBe(true);
    expect((await listSessionOrigins(current)).items).toMatchObject([
      { sessionId: "same-session", agentId: "expert-a", packageName: "pkg-a" },
    ]);
  });

  test("one marker conflict does not make a healthy warehouse incomplete", async () => {
    const current = await workspace("conflict-sibling");
    const healthyA = await markerRoot(current, "expert-ok-a", "session-ok-a");
    const segment = createHash("sha256")
      .update(`${current.id}\0${current.path}`)
      .digest("hex")
      .slice(0, 16);
    const healthyBDir = join(healthyA.runtimeRoot, segment, "expert-ok-b", "legacy-key");
    const conflictDir = join(healthyA.runtimeRoot, segment, "expert-a", "legacy-key");
    await mkdir(healthyBDir, { recursive: true });
    await mkdir(conflictDir, { recursive: true });
    await writeMarker(healthyA.directory, current.id, {
      isolationVersion: 3, agentId: "expert-ok-a", packageName: "pkg-ok-a", sessionId: "session-ok-a",
      declaredSkills: [], installedSkills: [], missingSkills: [],
    });
    await writeMarker(healthyBDir, current.id, {
      isolationVersion: 3, agentId: "expert-ok-b", packageName: "pkg-ok-b", sessionId: "session-ok-b",
      declaredSkills: [], installedSkills: [], missingSkills: [],
    });
    await writeMarker(conflictDir, current.id, {
      isolationVersion: 3, agentId: "expert-a", packageName: "pkg-a", sessionId: "session-conflict",
      declaredSkills: [], installedSkills: [], missingSkills: [],
    });
    await upsertSessionOrigin(current, "session-ok-a", {
      kind: "expert", agentId: "expert-ok-a", packageName: "pkg-ok-a", directory: healthyA.directory,
    });
    await upsertSessionOrigin(current, "session-ok-b", {
      kind: "expert", agentId: "expert-ok-b", packageName: "pkg-ok-b", directory: healthyBDir,
    });
    await upsertSessionOrigin(current, "session-conflict", {
      kind: "expert", agentId: "expert-b", packageName: "pkg-b", directory: conflictDir,
    });
    const result = await buildExpertDirectory(current, {
      runtimeRoot: healthyA.runtimeRoot,
      readSessions: async () => [
        { id: "session-ok-a", directory: healthyA.directory },
        { id: "session-ok-b", directory: healthyBDir },
        { id: "session-conflict", directory: conflictDir },
      ],
    });
    expect(result.failures).toMatchObject([{ code: "marker_identity_conflict" }]);
    expect(result.complete).toBe(true);
    expect(result.records.flatMap((record) => record.sessionIds).sort()).toEqual([
      "session-conflict",
      "session-ok-a",
      "session-ok-b",
    ]);
  });

  test("legacy_identity_unresolved still marks the warehouse incomplete", async () => {
    const current = await workspace("unresolved-incomplete");
    const originsPath = join(current.path, ".opencode", "onmyagent", "session-origins.json");
    await mkdir(join(current.path, ".opencode", "onmyagent"), { recursive: true });
    await writeFile(originsPath, JSON.stringify({
      version: 2,
      revision: 1,
      records: [{
        workspaceId: current.id,
        sessionId: "session-blank",
        kind: "expert",
        createdAt: 1,
        updatedAt: 1,
      }],
      tombstones: [],
    }));
    const projection = await buildExpertDirectory(current, {
      runtimeRoot: join(tmpdir(), "onmyagent-no-runtime-unresolved"),
      readSessions: async () => [{ id: "session-blank" }],
    });
    expect(projection.complete).toBe(false);
    expect(projection.failures).toMatchObject([{ code: "legacy_identity_unresolved" }]);
  });

  test("duplicate conflicting v3 markers remain fail-closed during apply", async () => {
    const current = await workspace("duplicate-conflict");
    const first = await markerRoot(current, "expert-a", "same-session");
    const workspaceSegment = createHash("sha256")
      .update(`${current.id}\0${current.path}`)
      .digest("hex")
      .slice(0, 16);
    const secondDirectory = join(
      first.runtimeRoot,
      workspaceSegment,
      "expert-b",
      "legacy-key",
    );
    await mkdir(secondDirectory, { recursive: true });
    await writeMarker(first.directory, current.id, {
      isolationVersion: 3,
      agentId: "expert-a",
      packageName: "pkg-a",
      sessionId: "same-session",
      declaredSkills: [],
      installedSkills: [],
      missingSkills: [],
    });
    await writeMarker(secondDirectory, current.id, {
      isolationVersion: 3,
      agentId: "expert-b",
      packageName: "pkg-b",
      sessionId: "same-session",
      declaredSkills: [],
      installedSkills: [],
      missingSkills: [],
    });
    const result = await healExpertDirectory(current, {
      apply: true,
      expectedRevision: 0,
    }, {
      runtimeRoot: first.runtimeRoot,
      readSessions: async () => [{ id: "same-session", directory: first.directory }],
    });
    expect(result.complete).toBe(false);
    expect(result.actions).toHaveLength(2);
    expect(result.actions.every((action) =>
      action.result === "skipped" && action.code === "marker_identity_conflict"
    )).toBe(true);
    expect((await listSessionOrigins(current)).items).toEqual([]);
  });

  test("dry-run leaves marker bytes unchanged and tombstones are protected", async () => {
    const current = await workspace("tombstone");
    const marker = await markerRoot(current, "expert-a", "tombstoned-session");
    await writeMarker(marker.directory, current.id, {
      isolationVersion: 3, agentId: "expert-a", packageName: "pkg-a", sessionId: "tombstoned-session",
      declaredSkills: [], installedSkills: [], missingSkills: [],
    });
    await upsertSessionOrigin(current, "tombstoned-session", {
      kind: "expert", agentId: "expert-a", packageName: "pkg-a", directory: marker.directory,
    });
    const origins = await listSessionOrigins(current);
    await deleteSessionOrigin(current, "tombstoned-session", { expectedRevision: origins.revision });
    const before = await Bun.file(join(marker.directory, "onmyagent-session.json")).text();
    const lookup = async () => [{ id: "tombstoned-session", directory: marker.directory }];
    const dry = await healExpertDirectory(current, {}, { runtimeRoot: marker.runtimeRoot, readSessions: lookup });
    expect(dry.actions).toMatchObject([{ code: "tombstone_protected", result: "skipped" }]);
    expect(await Bun.file(join(marker.directory, "onmyagent-session.json")).text()).toBe(before);
    const restored = await healExpertDirectory(current, {
      apply: true,
      restoreTombstoned: true,
      expectedRevision: (await listSessionOrigins(current)).revision,
    }, { runtimeRoot: marker.runtimeRoot, readSessions: lookup });
    expect(restored.complete).toBe(true);
    expect((await listSessionOrigins(current)).items).toMatchObject([{ sessionId: "tombstoned-session" }]);
  });

  test("apply upgrades a legacy marker before origin write and replays idempotently", async () => {
    const current = await workspace("legacy-apply");
    const marker = await markerRoot(current, "legacy-agent", "real-session-id");
    await writeMarker(marker.directory, current.id, {
      isolationVersion: 2,
      agent: "legacy-agent",
      sessionKey: "timestamp-key-not-an-id",
      declaredSkills: [],
      installedSkills: [],
      missingSkills: [],
    });
    const lookup = async () => [{ id: marker.session, directory: await realpath(marker.directory) }];
    const applied = await healExpertDirectory(current, {
      apply: true,
      expectedRevision: 0,
    }, { runtimeRoot: marker.runtimeRoot, readSessions: lookup });
    expect(applied.actions.map((action) => action.kind)).toEqual([
      "upgrade_marker",
      "write_origin",
    ]);
    const persistedMarker = JSON.parse(
      await Bun.file(join(marker.directory, "onmyagent-session.json")).text(),
    ) as Record<string, unknown>;
    expect(persistedMarker).toMatchObject({
      isolationVersion: 3,
      sessionId: marker.session,
      agentId: "legacy-agent",
      packageName: "legacy-agent",
    });
    expect((await listSessionOrigins(current)).items).toMatchObject([
      { sessionId: marker.session, agentId: "legacy-agent" },
    ]);
    const replay = await healExpertDirectory(current, {
      apply: true,
      expectedRevision: applied.revision,
    }, { runtimeRoot: marker.runtimeRoot, readSessions: lookup });
    expect(replay.actions).toEqual([]);
  });
});
