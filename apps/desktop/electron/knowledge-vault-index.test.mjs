import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { searchKnowledgeNotes } from "./knowledge-vault-index.mjs";
import {
  rebuildKnowledgeVaultIndex,
  searchKnowledgeVault,
  writeKnowledgeFile,
} from "./knowledge-vault-io.mjs";

describe("knowledge FTS reuse", () => {
  test("second search over an unchanged vault reuses the standing index", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-fts-"));
    try {
      await writeKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "briefs/q3.md",
        content: "# Q3 brief\n\nLaunch the autumn campaign in October.\n",
      });

      const first = await searchKnowledgeVault({
        homeDir: home,
        query: "autumn campaign",
        scope: "user",
      });
      assert.equal(first.ok, true);
      assert.equal(first.backend, "fts5");
      assert.equal(first.index, "rebuilt");
      assert.ok(first.hits.some((hit) => hit.relPath === "briefs/q3.md"));

      const viaNotes = await searchKnowledgeNotes({
        homeDir: home,
        query: "autumn",
        scopes: [{ scope: "user" }],
      });
      assert.equal(viaNotes.index, "reused");

      const second = await searchKnowledgeVault({
        homeDir: home,
        query: "autumn campaign",
        scope: "user",
      });
      assert.equal(second.ok, true);
      assert.equal(second.backend, "fts5");
      assert.equal(second.index, "reused");
      assert.ok(second.hits.some((hit) => hit.relPath === "briefs/q3.md"));

      await writeKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "briefs/q4.md",
        content: "# Q4\n\nWinter plan.\n",
      });
      const rebuilt = await rebuildKnowledgeVaultIndex({
        homeDir: home,
        scope: "user",
      });
      assert.equal(rebuilt.ok, true);
      assert.equal(rebuilt.index, "rebuilt");
      assert.ok(Number(rebuilt.count) >= 2);
      const afterRebuild = await searchKnowledgeVault({
        homeDir: home,
        query: "Winter plan",
        scope: "user",
      });
      assert.equal(afterRebuild.index, "reused");
      assert.ok(afterRebuild.hits.some((hit) => hit.relPath === "briefs/q4.md"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
