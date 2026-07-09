import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSessionArchiveCacheStore } from "../src/services/session-archive-cache-store.js";
import type { SessionArchiveSummary } from "../src/services/session-archive-cache.js";

function makeSummary(id: string, override: Partial<SessionArchiveSummary> = {}): SessionArchiveSummary {
  return {
    agent: "codex",
    sourceRoot: "/tmp/root",
    filePath: `/tmp/root/${id}.jsonl`,
    sessionId: id,
    title: `Title ${id}`,
    projectDir: `/tmp/proj/${id}`,
    createdAt: "2026-07-01T00:00:00Z",
    lastActiveAt: "2026-07-06T00:00:00Z",
    size: 1024,
    mtimeMs: 1_720_000_000_000,
    ino: 42,
    ...override,
  };
}

describe("session-archive cache store", () => {
  test("upsert + loadAll round-trip preserves fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sa-cache-"));
    const store = await openSessionArchiveCacheStore({ dbPath: join(dir, "cache.sqlite") });
    try {
      store.upsertMany([makeSummary("a"), makeSummary("b")]);
      const rows = store.loadAll();
      expect(rows.map((r) => r.sessionId).sort()).toEqual(["a", "b"]);
      const a = rows.find((r) => r.sessionId === "a");
      expect(a?.title).toBe("Title a");
      expect(a?.size).toBe(1024);
      expect(a?.mtimeMs).toBe(1_720_000_000_000);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("upsert on existing file_path updates in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sa-cache-"));
    const store = await openSessionArchiveCacheStore({ dbPath: join(dir, "cache.sqlite") });
    try {
      store.upsertMany([makeSummary("a", { title: "First" })]);
      store.upsertMany([makeSummary("a", { title: "Second", size: 2048 })]);
      const rows = store.loadAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Second");
      expect(rows[0].size).toBe(2048);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("replaceAll clears rows not present in the new set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sa-cache-"));
    const store = await openSessionArchiveCacheStore({ dbPath: join(dir, "cache.sqlite") });
    try {
      store.upsertMany([makeSummary("a"), makeSummary("b"), makeSummary("c")]);
      store.replaceAll([makeSummary("b"), makeSummary("d")]);
      const rows = store.loadAll();
      expect(rows.map((r) => r.sessionId).sort()).toEqual(["b", "d"]);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("deleteMany removes only specified filePaths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sa-cache-"));
    const store = await openSessionArchiveCacheStore({ dbPath: join(dir, "cache.sqlite") });
    try {
      const a = makeSummary("a");
      const b = makeSummary("b");
      store.upsertMany([a, b]);
      store.deleteMany([a.filePath]);
      const rows = store.loadAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].sessionId).toBe("b");
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
