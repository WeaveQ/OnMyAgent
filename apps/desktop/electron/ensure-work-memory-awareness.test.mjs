/**
 * Work memory awareness seed on install / cold start.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  WORK_MEMORY_CORE_FILES,
  WORK_MEMORY_SEED_FILES,
  ensureWorkMemoryAwareness,
  resolveWorkMemoryAwarenessMainDir,
} from "./ensure-work-memory-awareness.mjs";

describe("ensureWorkMemoryAwareness", () => {
  test("creates core seed files under data/user/awareness/main", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-awareness-"));
    try {
      const result = await ensureWorkMemoryAwareness({ homeDir: home });
      assert.equal(result.ok, true);
      assert.equal(
        result.path,
        resolveWorkMemoryAwarenessMainDir(home),
      );
      for (const name of WORK_MEMORY_CORE_FILES) {
        assert.ok(
          result.created.includes(name),
          `expected ${name} in created`,
        );
        const body = await readFile(path.join(result.path, name), "utf8");
        assert.equal(body, WORK_MEMORY_SEED_FILES[name]);
      }
      assert.ok(result.created.includes("profile.md"));
      assert.ok(result.created.includes("pending.json"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("does not overwrite existing user files on re-run", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-awareness-"));
    try {
      const first = await ensureWorkMemoryAwareness({ homeDir: home });
      const custom = "# My style\n\nkeep me\n";
      await writeFile(path.join(first.path, "style.md"), custom, "utf8");

      const second = await ensureWorkMemoryAwareness({ homeDir: home });
      assert.equal(second.created.length, 0);
      assert.ok(second.existing.includes("style.md"));
      const body = await readFile(path.join(second.path, "style.md"), "utf8");
      assert.equal(body, custom);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("path is under data/user/awareness not config tree", () => {
    const main = resolveWorkMemoryAwarenessMainDir("/Users/hope");
    assert.equal(
      main,
      path.join(
        "/Users/hope",
        ".onmyagent",
        "data",
        "user",
        "awareness",
        "main",
      ),
    );
    assert.ok(!main.includes("profiles"));
    assert.ok(!main.includes("config/experts"));
  });
});
