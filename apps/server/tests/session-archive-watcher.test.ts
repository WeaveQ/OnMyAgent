import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startSessionArchiveWatcher } from "../src/services/session-archive-watcher.js";

describe("session-archive watcher", () => {
  test("fires onBatch after a file appears in a configured root", async () => {
    const home = await mkdtemp(join(tmpdir(), "sa-watch-"));
    await mkdir(join(home, ".codex/sessions"), { recursive: true });
    let batches = 0;
    const handle = startSessionArchiveWatcher({
      homeDir: home,
      env: {},
      debounceMs: 60,
      onBatch: () => {
        batches += 1;
      },
    });
    try {
      // Give the watcher a moment to attach before mutating.
      await new Promise((resolve) => setTimeout(resolve, 30));
      await writeFile(join(home, ".codex/sessions/new.jsonl"), "{}\n");
      // Wait past the debounce window plus fs event latency.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(batches).toBeGreaterThan(0);
    } finally {
      handle.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test("close stops further batches", async () => {
    const home = await mkdtemp(join(tmpdir(), "sa-watch-"));
    await mkdir(join(home, ".codex/sessions"), { recursive: true });
    let batches = 0;
    const handle = startSessionArchiveWatcher({
      homeDir: home,
      env: {},
      debounceMs: 60,
      onBatch: () => {
        batches += 1;
      },
    });
    handle.close();
    try {
      await writeFile(join(home, ".codex/sessions/late.jsonl"), "{}\n");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(batches).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
