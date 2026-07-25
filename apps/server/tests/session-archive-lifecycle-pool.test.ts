/**
 * Lifecycle status must use the shared archive store pool (acquire/release),
 * not a bare openSessionArchiveStore + store.close() path.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getSessionArchiveLifecycleStatus } from "../src/services/session-archive-lifecycle.js";
import { createSessionArchiveStorePool } from "../src/services/session-archive-store-pool.js";
import type { SessionArchiveStore } from "../src/services/session-archive-types.js";
import type { SessionArchiveStats } from "@onmyagent/types/session-archive";

const emptyStats = (): SessionArchiveStats =>
  ({
    total_sessions: 0,
    total_messages: 0,
    total_tokens: 0,
  }) as SessionArchiveStats;

function fakeStore(id: string): SessionArchiveStore {
  return {
    dbPath: id,
    close: () => {
      throw new Error(
        "lifecycle must not close the store — pool owns the handle",
      );
    },
    stats: emptyStats,
  } as SessionArchiveStore;
}

describe("session-archive lifecycle via pool (shipped)", () => {
  test("getSessionArchiveLifecycleStatus acquires/releases pool and never bare-closes", async () => {
    let opens = 0;
    let closes = 0;
    const pool = createSessionArchiveStorePool({
      idleTtlMs: 0,
      open: async (input) => {
        opens += 1;
        const base = fakeStore(input.dbPath);
        return {
          ...base,
          close: () => {
            closes += 1;
          },
        } as SessionArchiveStore;
      },
    });

    const root = await mkdtemp(join(tmpdir(), "archive-lifecycle-"));
    const dbPath = join(root, "archive.sqlite");
    // Touch a non-empty file so db_exists/bytes reflect real fs stats.
    await writeFile(dbPath, "sqlite-placeholder");
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(join(root, "logs", "archive.log"), "hello");

    const startedAt = Date.now() - 5_000;
    const status = await getSessionArchiveLifecycleStatus({
      paths: {
        root,
        dbPath,
      } as Parameters<typeof getSessionArchiveLifecycleStatus>[0]["paths"],
      startedAt,
      version: "test-version",
      pool,
    });

    expect(opens).toBe(1);
    // withSessionArchiveStore released; idleTtlMs=0 closes immediately via pool.
    expect(closes).toBe(1);
    expect(pool.stats().liveEntries).toBe(0);
    expect(pool.stats().totalRefs).toBe(0);

    expect(status.healthy).toBe(true);
    expect(status.version).toBe("test-version");
    expect(status.mode).toBe("studio-native");
    expect(status.db_path).toBe(dbPath);
    expect(status.db_exists).toBe(true);
    expect(status.db_bytes).toBeGreaterThan(0);
    expect(status.uptime_ms).toBeGreaterThanOrEqual(4_000);
    expect(status.runtime_root).toBe(root);
    expect(status.logs.files.some((f) => f.name === "archive.log")).toBe(true);

    pool.disposeAll();
  });

  test("second lifecycle call reuses pool open when idle TTL keeps entry live", async () => {
    let opens = 0;
    const pool = createSessionArchiveStorePool({
      idleTtlMs: 60_000,
      open: async (input) => {
        opens += 1;
        return fakeStore(input.dbPath);
      },
    });
    const root = await mkdtemp(join(tmpdir(), "archive-lifecycle-reuse-"));
    const dbPath = join(root, "archive.sqlite");
    await writeFile(dbPath, "x");

    const paths = { root, dbPath } as Parameters<
      typeof getSessionArchiveLifecycleStatus
    >[0]["paths"];
    await getSessionArchiveLifecycleStatus({
      paths,
      startedAt: Date.now(),
      version: "v1",
      pool,
    });
    await getSessionArchiveLifecycleStatus({
      paths,
      startedAt: Date.now(),
      version: "v1",
      pool,
    });
    // First call released but idle TTL keeps handle; second acquire reuses it.
    expect(opens).toBe(1);
    expect(pool.stats().openCount).toBe(1);
    pool.disposeAll();
  });
});

describe("lifecycle source wiring (structural)", () => {
  test("lifecycle module uses withSessionArchiveStore, not bare openSessionArchiveStore", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(import.meta.dir, "../src/services/session-archive-lifecycle.ts"),
      "utf8",
    );
    expect(src).toContain("withSessionArchiveStore");
    expect(src).toContain("session-archive-store-pool");
    expect(src).not.toMatch(
      /from ["']\.\/session-archive\.js["']/,
    );
    expect(src).not.toContain("openSessionArchiveStore");
    expect(src).not.toMatch(/store\.close\s*\(/);
  });
});
