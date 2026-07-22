import { describe, expect, test } from "bun:test";
import {
  createSessionArchiveStorePool,
  withSessionArchiveStore,
} from "../src/services/session-archive-store-pool.js";
import type { SessionArchiveStore } from "../src/services/session-archive-types.js";

function fakeStore(id: string): SessionArchiveStore {
  return {
    dbPath: id,
    close: () => undefined,
  } as SessionArchiveStore;
}

describe("session-archive store pool (shipped)", () => {
  test("reuses one open across multiple acquires of the same dbPath", async () => {
    let opens = 0;
    const pool = createSessionArchiveStorePool({
      idleTtlMs: 60_000,
      open: async (input) => {
        opens += 1;
        return fakeStore(input.dbPath);
      },
    });

    const a = await pool.acquire({ dbPath: "/tmp/archive-a.sqlite" });
    const b = await pool.acquire({ dbPath: "/tmp/archive-a.sqlite" });
    expect(a).toBe(b);
    expect(opens).toBe(1);
    expect(pool.stats().openCount).toBe(1);
    expect(pool.stats().totalRefs).toBe(2);

    pool.release({ dbPath: "/tmp/archive-a.sqlite" });
    pool.release({ dbPath: "/tmp/archive-a.sqlite" });
    // Still live until idle TTL; openCount does not increase.
    const c = await pool.acquire({ dbPath: "/tmp/archive-a.sqlite" });
    expect(c).toBe(a);
    expect(opens).toBe(1);
    pool.release({ dbPath: "/tmp/archive-a.sqlite" });
    pool.disposeAll();
  });

  test("different dbPaths open separately", async () => {
    let opens = 0;
    const pool = createSessionArchiveStorePool({
      idleTtlMs: 0,
      open: async (input) => {
        opens += 1;
        return fakeStore(input.dbPath);
      },
    });
    await pool.acquire({ dbPath: "/tmp/a.sqlite" });
    await pool.acquire({ dbPath: "/tmp/b.sqlite" });
    expect(opens).toBe(2);
    pool.release({ dbPath: "/tmp/a.sqlite" });
    pool.release({ dbPath: "/tmp/b.sqlite" });
    pool.disposeAll();
  });

  test("withSessionArchiveStore releases after work", async () => {
    let opens = 0;
    const pool = createSessionArchiveStorePool({
      idleTtlMs: 0,
      open: async (input) => {
        opens += 1;
        return fakeStore(input.dbPath);
      },
    });
    const value = await withSessionArchiveStore(
      { dbPath: "/tmp/w.sqlite", pool },
      async (store) => {
        expect(store.dbPath).toBe("/tmp/w.sqlite");
        return 42;
      },
    );
    expect(value).toBe(42);
    expect(opens).toBe(1);
    expect(pool.stats().liveEntries).toBe(0);
    pool.disposeAll();
  });

  test("concurrent Promise.all acquire of same dbPath opens once and tracks refs", async () => {
    let opens = 0;
    let openGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const pool = createSessionArchiveStorePool({
      idleTtlMs: 60_000,
      open: async (input) => {
        opens += 1;
        await gate;
        return fakeStore(input.dbPath);
      },
    });

    const pendingA = pool.acquire({ dbPath: "/tmp/concurrent.sqlite" });
    const pendingB = pool.acquire({ dbPath: "/tmp/concurrent.sqlite" });
    // Both waits share one in-flight open before it resolves.
    openGate?.();
    const [a, b] = await Promise.all([pendingA, pendingB]);
    expect(a).toBe(b);
    expect(opens).toBe(1);
    expect(pool.stats().openCount).toBe(1);
    expect(pool.stats().totalRefs).toBe(2);
    expect(pool.stats().liveEntries).toBe(1);

    pool.release({ dbPath: "/tmp/concurrent.sqlite" });
    expect(pool.stats().totalRefs).toBe(1);
    pool.release({ dbPath: "/tmp/concurrent.sqlite" });
    expect(pool.stats().totalRefs).toBe(0);
    pool.disposeAll();
  });
});
