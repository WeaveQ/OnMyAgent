/**
 * Knowledge vault seed on install / cold start.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  KNOWLEDGE_GETTING_STARTED_SEED,
  KNOWLEDGE_SEED_FILES,
  ensureKnowledgeVault,
} from "./ensure-knowledge-vault.mjs";
import {
  GETTING_STARTED_REL_PATH,
  resolveKnowledgeRoot,
  resolveUserVaultDir,
} from "./knowledge-vault-paths.mjs";

describe("ensureKnowledgeVault", () => {
  test("creates getting-started.md under data/user/knowledge/vault", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-knowledge-"));
    try {
      const result = await ensureKnowledgeVault({ homeDir: home });
      assert.equal(result.ok, true);
      assert.equal(result.root, resolveKnowledgeRoot(home));
      assert.equal(result.path, resolveUserVaultDir(home));
      assert.ok(result.created.includes(GETTING_STARTED_REL_PATH));
      const body = await readFile(
        path.join(result.path, GETTING_STARTED_REL_PATH),
        "utf8",
      );
      assert.equal(body, KNOWLEDGE_GETTING_STARTED_SEED);
      assert.equal(body, KNOWLEDGE_SEED_FILES[GETTING_STARTED_REL_PATH]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("does not overwrite existing user files on re-run", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-knowledge-"));
    try {
      const first = await ensureKnowledgeVault({ homeDir: home });
      const custom = "# My notes\n\nkeep me\n";
      await writeFile(path.join(first.path, GETTING_STARTED_REL_PATH), custom, "utf8");

      const second = await ensureKnowledgeVault({ homeDir: home });
      assert.equal(second.created.length, 0);
      assert.ok(second.existing.includes(GETTING_STARTED_REL_PATH));
      const body = await readFile(
        path.join(second.path, GETTING_STARTED_REL_PATH),
        "utf8",
      );
      assert.equal(body, custom);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("path is under data/user/knowledge, not skills or awareness", () => {
    const root = resolveKnowledgeRoot("/Users/hope");
    assert.equal(
      root,
      path.join("/Users/hope", ".onmyagent", "data", "user", "knowledge"),
    );
    assert.ok(!root.includes("profiles"));
    assert.ok(!root.includes("skills"));
    assert.ok(!root.includes("awareness"));
  });
});
