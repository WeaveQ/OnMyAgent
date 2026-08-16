import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { walkKnowledgeTree } from "./knowledge-vault-walk.mjs";

describe("walkKnowledgeTree", () => {
  test("walks nested notes and skips hidden / oversized non-indexable unless asked", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oma-kv-walk-"));
    try {
      await mkdir(path.join(root, "briefs"), { recursive: true });
      await writeFile(path.join(root, "briefs", "q3.md"), "# Q3\n", "utf8");
      await writeFile(path.join(root, ".secret.md"), "nope", "utf8");
      await writeFile(path.join(root, "sheet.xlsx"), "raw", "utf8");

      const indexable = await walkKnowledgeTree(root);
      assert.deepEqual(
        indexable.map((file) => file.relPath),
        ["briefs/q3.md"],
      );

      const all = await walkKnowledgeTree(root, { includeNonIndexable: true });
      assert.ok(all.some((file) => file.relPath === "sheet.xlsx" && file.indexable === false));
      assert.ok(!all.some((file) => file.relPath === ".secret.md"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
