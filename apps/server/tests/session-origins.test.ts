import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SessionOriginRecord, WorkspaceInfo } from "@onmyagent/types/server";
import {
  deleteSessionOrigin,
  listSessionOrigins,
  sessionOriginsPath,
  upsertSessionOrigin,
} from "../src/services/session-origins.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function workspace(id = "workspace-a"): Promise<WorkspaceInfo> {
  const path = await mkdtemp(join(tmpdir(), "onmyagent-session-origin-"));
  roots.push(path);
  return { id, name: id, path, preset: "starter", workspaceType: "local" };
}

function originRecord(
  workspaceId: string,
  sessionId: string,
  kind: SessionOriginRecord["kind"] = "expert",
): SessionOriginRecord {
  return {
    workspaceId,
    sessionId,
    kind,
    agentId: "agent-fixture",
    packageName: "package-fixture",
    directory: "/external/runtime/session",
    createdAt: 100,
    updatedAt: 200,
  };
}

describe("session origins", () => {
  test("persists workspace-owned origins atomically and preserves created time on upsert", async () => {
    const target = await workspace();
    const first = await upsertSessionOrigin(target, "session-1", {
      kind: "expert",
      agentId: "agent-a",
      packageName: "package-a",
      directory: "/external/runtime/session-1",
    });
    const second = await upsertSessionOrigin(target, "session-1", { kind: "assistant", directory: "/tmp/assistant" });

    expect(second.workspaceId).toBe(target.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect((await listSessionOrigins(target)).items).toEqual([second]);
    expect(JSON.parse(await readFile(sessionOriginsPath(target), "utf8"))).toMatchObject({
      version: 2,
      revision: 2,
      tombstones: [],
    });
  });

  test("returns an empty list for corrupted state and fails closed without overwriting it", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await upsertSessionOrigin(target, "session-1", { kind: "automation" });
    const corrupt = "not json";
    await writeFile(path, corrupt, "utf8");

    expect((await listSessionOrigins(target)).items).toEqual([]);
    await expect(deleteSessionOrigin(target, "missing")).rejects.toMatchObject({
      code: "session_origins_version_unsupported",
    });
    await expect(deleteSessionOrigin(target, "session-1")).rejects.toMatchObject({
      code: "session_origins_version_unsupported",
    });
    expect(await readFile(path, "utf8")).toBe(corrupt);
  });

  test("reads v2 records and applies tombstones only to matching workspace and session", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await mkdir(dirname(path), { recursive: true });
    const kept = originRecord(target.id, "session-keep");
    const hidden = originRecord(target.id, "session-hidden");
    const foreignWorkspace = originRecord("workspace-b", "session-keep");
    await writeFile(
      path,
      `${JSON.stringify({
        version: 2,
        revision: 7,
        records: [kept, hidden, foreignWorkspace],
        tombstones: [
          { workspaceId: target.id, sessionId: hidden.sessionId, reason: "user_delete" },
          { workspaceId: "workspace-b", sessionId: kept.sessionId, reason: "foreign_delete" },
          { workspaceId: target.id, sessionId: "different-session", reason: "session_mismatch" },
        ],
      })}\n`,
      "utf8",
    );

    expect((await listSessionOrigins(target)).items).toEqual([kept]);
  });

  test("keeps v2 on mutations, advances revision, and round-trips tombstones", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await mkdir(dirname(path), { recursive: true });
    const stale = originRecord(target.id, "session-1");
    const foreign = originRecord("workspace-b", "session-foreign");
    const foreignHidden = originRecord("workspace-b", "session-hidden");
    await writeFile(
      path,
      `${JSON.stringify({
        version: 2,
        revision: 10,
        records: [stale, foreign, foreignHidden],
        tombstones: [
          { workspaceId: "workspace-b", sessionId: "session-old", reason: "foreign_delete" },
          { workspaceId: foreignHidden.workspaceId, sessionId: foreignHidden.sessionId, reason: "foreign_hidden" },
        ],
      })}\n`,
      "utf8",
    );

    const upserted = await upsertSessionOrigin(target, "session-1", {
      kind: "assistant",
      agentId: "agent-updated",
    });
    expect(upserted.kind).toBe("assistant");
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 2,
      revision: 11,
      tombstones: [
        { workspaceId: "workspace-b", sessionId: "session-old" },
        { workspaceId: foreignHidden.workspaceId, sessionId: foreignHidden.sessionId, reason: "foreign_hidden" },
      ],
    });

    await deleteSessionOrigin(target, "session-1");
    const afterDelete = JSON.parse(await readFile(path, "utf8"));
    expect(afterDelete).toMatchObject({
      version: 2,
      revision: 12,
      tombstones: [
        { workspaceId: "workspace-b", sessionId: "session-old" },
        { workspaceId: foreignHidden.workspaceId, sessionId: foreignHidden.sessionId, reason: "foreign_hidden" },
        { workspaceId: target.id, sessionId: "session-1", reason: "user_delete" },
      ],
    });
    expect(afterDelete.records).toEqual([foreign, foreignHidden]);
    await deleteSessionOrigin(target, "session-1");
    expect(JSON.parse(await readFile(path, "utf8")).revision).toBe(12);

    await upsertSessionOrigin(target, "session-1", {
      kind: "expert",
      agentId: "agent-restored",
      packageName: "package-restored",
      directory: "/external/runtime/session-1",
      expectedRevision: 12,
    });
    const afterRestore = JSON.parse(await readFile(path, "utf8"));
    expect(afterRestore).toMatchObject({ version: 2, revision: 13 });
    expect(afterRestore.records).toHaveLength(3);
    expect(afterRestore.tombstones).toEqual([
      { workspaceId: "workspace-b", sessionId: "session-old", reason: "foreign_delete" },
      { workspaceId: foreignHidden.workspaceId, sessionId: foreignHidden.sessionId, reason: "foreign_hidden" },
    ]);
    expect((await listSessionOrigins(target)).items).toHaveLength(1);
  });

  test("preserves parseable records for unknown versions and fails closed on writes", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await mkdir(dirname(path), { recursive: true });
    const record = originRecord(target.id, "future-session");
    await writeFile(path, `${JSON.stringify({ version: 99, revision: 3, records: [record] })}\n`, "utf8");

    expect((await listSessionOrigins(target)).items).toEqual([record]);
    await expect(upsertSessionOrigin(target, "new-session", { kind: "assistant" })).rejects.toMatchObject({
      code: "session_origins_version_unsupported",
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 99, records: [record] });
  });

  test("does not throw or claim records for corrupt and truncated fixtures", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await mkdir(dirname(path), { recursive: true });
    for (const contents of ["not json", '{"version":2,"records":']) {
      await writeFile(path, contents, "utf8");
      await expect(listSessionOrigins(target)).resolves.toMatchObject({ items: [], complete: false });
      await expect(upsertSessionOrigin(target, "must-not-overwrite", {
        kind: "expert",
        agentId: "agent-fixture",
        packageName: "package-fixture",
        directory: "/external/runtime/session",
      }))
        .rejects.toMatchObject({ code: "session_origins_version_unsupported" });
      expect(await readFile(path, "utf8")).toBe(contents);
    }
  });

  test("reads recoverable v2 records but fails closed on malformed v2 metadata", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await mkdir(dirname(path), { recursive: true });
    const record = originRecord(target.id, "recoverable-session");
    const fixtures = [
      { version: 2, records: [record], tombstones: [] },
      { version: 2, revision: -1, records: [record], tombstones: [] },
      { version: 2, revision: 1.5, records: [record], tombstones: [] },
      { version: 2, revision: 2, records: [record] },
      { version: 2, revision: 2, records: [record], tombstones: [{ workspaceId: target.id }] },
    ];

    for (const fixture of fixtures) {
      const contents = `${JSON.stringify(fixture)}\n`;
      await writeFile(path, contents, "utf8");
      expect((await listSessionOrigins(target)).items).toEqual([record]);
      await expect(deleteSessionOrigin(target, record.sessionId)).rejects.toMatchObject({
        code: "session_origins_version_unsupported",
      });
      expect(await readFile(path, "utf8")).toBe(contents);
    }
  });

  test("salvages tombstone identity for reads but rejects malformed optional metadata on writes", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await mkdir(dirname(path), { recursive: true });
    const record = originRecord(target.id, "deleted-session");
    const contents = `${JSON.stringify({
      version: 2,
      revision: 4,
      records: [record],
      tombstones: [{
        workspaceId: target.id,
        sessionId: record.sessionId,
        deletedAt: "invalid",
        reason: "user_delete",
      }],
    })}\n`;
    await writeFile(path, contents, "utf8");

    expect((await listSessionOrigins(target)).items).toEqual([]);
    await expect(upsertSessionOrigin(target, record.sessionId, {
      kind: "expert",
      agentId: "agent-fixture",
      packageName: "package-fixture",
      directory: "/external/runtime/session",
    }))
      .rejects.toMatchObject({ code: "session_origins_version_unsupported" });
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  test("serializes concurrent writes for the same workspace", async () => {
    const target = await workspace();
    await Promise.all([
      upsertSessionOrigin(target, "session-a", { kind: "assistant" }),
      upsertSessionOrigin(target, "session-b", { kind: "automation" }),
    ]);
    expect((await listSessionOrigins(target)).items.map((item) => item.sessionId).sort()).toEqual(["session-a", "session-b"]);
  });

  test("never writes relative state for a workspace without a local path", async () => {
    const target = await workspace();
    target.path = "";
    await expect(listSessionOrigins(target)).rejects.toMatchObject({
      code: "session_origins_unavailable",
    });
  });

  test("rejects stale revision resurrection after a tombstone", async () => {
    const target = await workspace();
    await deleteSessionOrigin(target, "deleted-session");
    await expect(upsertSessionOrigin(target, "deleted-session", {
      kind: "expert",
      agentId: "agent-a",
      packageName: "package-a",
      directory: "/external/runtime/deleted-session",
      expectedRevision: 0,
    })).rejects.toMatchObject({ code: "session_origins_revision_conflict" });
    await expect(upsertSessionOrigin(target, "deleted-session", {
      kind: "expert",
      agentId: "agent-a",
      packageName: "package-a",
      directory: "/external/runtime/deleted-session",
      expectedRevision: 1,
    })).resolves.toMatchObject({ sessionId: "deleted-session" });
  });

  test("compacts only revisioned tombstones and requires revisions after watermark", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await mkdir(dirname(path), { recursive: true });
    const tombstones = Array.from({ length: 257 }, (_, index) => ({
      workspaceId: target.id,
      sessionId: `deleted-${index}`,
      deletedAt: index + 1,
      reason: "user_delete",
      revision: index + 1,
    }));
    await writeFile(path, `${JSON.stringify({
      version: 2,
      revision: 300,
      records: [],
      tombstones,
    })}\n`, "utf8");
    await upsertSessionOrigin(target, "new-session", { kind: "assistant", expectedRevision: 300 });
    const compacted = JSON.parse(await readFile(path, "utf8")) as {
      revision: number;
      tombstones: unknown[];
      tombstoneWatermark?: number;
    };
    expect(compacted.revision).toBe(301);
    expect(compacted.tombstones).toHaveLength(256);
    expect(compacted.tombstoneWatermark).toBe(1);
    await expect(deleteSessionOrigin(target, "another-session")).rejects.toMatchObject({
      code: "session_origins_revision_required",
    });
    await expect(deleteSessionOrigin(target, "another-session", { expectedRevision: 301 }))
      .resolves.toMatchObject({ revision: 302 });
  });

  test("preserves Windows-style identity paths and surfaces portable write failures", async () => {
    const target = await workspace();
    const windowsDirectory = "C:\\Users\\agent\\runtime\\session-1";
    const written = await upsertSessionOrigin(target, "windows-session", {
      kind: "expert",
      agentId: "windows-agent",
      packageName: "windows-package",
      directory: windowsDirectory,
    });
    expect(written.directory).toBe(windowsDirectory);

    const blocked = await workspace("write-failure");
    const blockedParent = join(blocked.path, ".opencode", "onmyagent");
    await mkdir(dirname(blockedParent), { recursive: true });
    await writeFile(blockedParent, "not-a-directory", "utf8");
    await expect(upsertSessionOrigin(blocked, "cannot-write", { kind: "assistant" })).rejects.toThrow();
  });
});
