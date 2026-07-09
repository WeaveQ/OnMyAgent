import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSessionArchiveIndex } from "../src/services/session-archive-index.js";

async function makeHome(): Promise<{ home: string; cacheDb: string }> {
  const home = await mkdtemp(join(tmpdir(), "sa-index-"));
  const codex = join(home, ".codex", "sessions");
  await mkdir(codex, { recursive: true });
  await writeFile(
    join(codex, "alpha.jsonl"),
    JSON.stringify({ sessionId: "alpha", title: "Alpha refactor", cwd: "/proj/a", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-06T00:00:00Z" }) + "\n" +
    JSON.stringify({ role: "user", content: "hello", timestamp: "2026-07-06T00:00:01Z" }) + "\n" +
    JSON.stringify({ role: "assistant", content: "world", timestamp: "2026-07-06T00:00:02Z" }) + "\n",
  );
  await writeFile(
    join(codex, "bravo.jsonl"),
    JSON.stringify({ sessionId: "bravo", title: "Bravo chat", cwd: "/proj/b", createdAt: "2026-07-02T00:00:00Z", updatedAt: "2026-07-07T00:00:00Z" }) + "\n" +
    JSON.stringify({ role: "user", content: "hi" }) + "\n",
  );
  return { home, cacheDb: join(home, "cache.sqlite") };
}

describe("session-archive index", () => {
  test("refresh + list surfaces summaries sorted by lastActive desc", async () => {
    const { home, cacheDb } = await makeHome();
    const index = await openSessionArchiveIndex({ homeDir: home, env: {}, cacheDbPath: cacheDb, autoWatch: false });
    try {
      const refreshed = await index.refresh();
      expect(refreshed.map((row) => row.sessionId)).toEqual(["bravo", "alpha"]);
      const page = index.list({ limit: 10 });
      expect(page.items.map((row) => row.sessionId)).toEqual(["bravo", "alpha"]);
      expect(page.total).toBe(2);
      expect(page.nextCursor).toBeNull();
      expect(page.agentCounts).toEqual([{ agent: "codex", count: 2 }]);
    } finally {
      index.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test("messages() streams role/content pairs from the source file", async () => {
    const { home, cacheDb } = await makeHome();
    const index = await openSessionArchiveIndex({ homeDir: home, env: {}, cacheDbPath: cacheDb, autoWatch: false });
    try {
      await index.refresh();
      const messages = await index.messages({ sessionId: "alpha" });
      expect(messages).toEqual([
        { role: "user", content: "hello", timestamp: "2026-07-06T00:00:01Z" },
        { role: "assistant", content: "world", timestamp: "2026-07-06T00:00:02Z" },
      ]);
    } finally {
      index.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test("deleteSession removes the source file and updates cache", async () => {
    const { home, cacheDb } = await makeHome();
    const index = await openSessionArchiveIndex({ homeDir: home, env: {}, cacheDbPath: cacheDb, autoWatch: false });
    try {
      await index.refresh();
      const deleted = await index.deleteSession("alpha");
      expect(deleted).toBe(true);
      const remaining = index.list({ limit: 10 });
      expect(remaining.items.map((row) => row.sessionId)).toEqual(["bravo"]);
    } finally {
      index.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test("persisted cache warm-loads on next open without re-scanning", async () => {
    const { home, cacheDb } = await makeHome();
    const index1 = await openSessionArchiveIndex({ homeDir: home, env: {}, cacheDbPath: cacheDb, autoWatch: false });
    await index1.refresh();
    index1.close();

    const index2 = await openSessionArchiveIndex({ homeDir: home, env: {}, cacheDbPath: cacheDb, autoWatch: false });
    try {
      const warm = index2.list({ limit: 10 });
      expect(warm.items.map((row) => row.sessionId).sort()).toEqual(["alpha", "bravo"]);
      expect(warm.items.find((row) => row.sessionId === "alpha")?.title).toBe("Alpha refactor");
    } finally {
      index2.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test("search + agent filter narrow the page", async () => {
    const { home, cacheDb } = await makeHome();
    const index = await openSessionArchiveIndex({ homeDir: home, env: {}, cacheDbPath: cacheDb, autoWatch: false });
    try {
      await index.refresh();
      const filtered = index.list({ search: "alpha" });
      expect(filtered.items.map((row) => row.sessionId)).toEqual(["alpha"]);
      const codexOnly = index.list({ agent: "codex" });
      expect(codexOnly.total).toBe(2);
      const otherAgent = index.list({ agent: "opencode" });
      expect(otherAgent.total).toBe(0);
    } finally {
      index.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
