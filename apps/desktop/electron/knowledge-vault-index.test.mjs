import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  buildFtsMatchQuery,
  collectKnowledgeManifest,
  searchKnowledgeNotes,
} from "./knowledge-vault-index.mjs";
import { resolveKnowledgeIndexPath } from "./knowledge-vault-paths.mjs";
import {
  rebuildKnowledgeVaultIndex,
  searchKnowledgeVault,
  writeKnowledgeFile,
} from "./knowledge-vault-io.mjs";

async function seedLegacyFtsWithoutFold(home) {
  const manifest = await collectKnowledgeManifest({
    homeDir: home,
    scopes: [{ scope: "user" }],
  });
  const db = new DatabaseSync(resolveKnowledgeIndexPath(home));
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      DROP TABLE IF EXISTS notes_fts;
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        scope UNINDEXED,
        rel_path UNINDEXED,
        title,
        body,
        tokenize = 'trigram'
      );
    `);
    db.prepare(
      "INSERT INTO notes_fts (scope, rel_path, title, body) VALUES (?, ?, ?, ?)",
    ).run(
      "user",
      "getting-started.md",
      "Knowledge vault / 知识库",
      "# Knowledge vault / 知识库\n\nPersonal notes only.\n",
    );
    const upsert = db.prepare(
      "INSERT INTO notes_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    upsert.run("fingerprint", manifest.fingerprint);
    upsert.run("schema", "1");
  } finally {
    db.close();
  }
}

describe("knowledge FTS reuse", () => {
  test("FTS match query ORs the hyphenated form of a spaced phrase", () => {
    assert.match(buildFtsMatchQuery("Getting started"), /getting-started/);
  });

  test("stale FTS without fold rebuilds so Getting started still hits", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-fts-stale-"));
    try {
      await writeKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "getting-started.md",
        content: "# Knowledge vault / 知识库\n\nPersonal notes only.\n",
      });
      await seedLegacyFtsWithoutFold(home);
      const result = await searchKnowledgeNotes({
        homeDir: home,
        query: "Getting started",
        scopes: [{ scope: "user" }],
      });
      assert.equal(result.ok, true);
      assert.equal(result.backend, "fts5");
      assert.equal(result.index, "rebuilt");
      assert.ok(
        result.hits.some((hit) => hit.relPath === "getting-started.md"),
        `stale index was reused without fold: hits=${JSON.stringify(result.hits)}`,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("filename-only FTS hit snippets the note body, not the folded path", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-fts-snippet-"));
    try {
      await writeKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "getting-started.md",
        content: "# Knowledge vault / 知识库\n\nPersonal notes only.\n",
      });
      const result = await searchKnowledgeVault({
        homeDir: home,
        query: "Getting started",
        scope: "user",
      });
      const hit = result.hits.find((item) => item.relPath === "getting-started.md");
      assert.ok(hit, `missing hyphenated seed: hits=${JSON.stringify(result.hits)}`);
      assert.match(String(hit.snippet), /Personal notes only/);
      assert.doesNotMatch(String(hit.snippet), /getting started\.md/i);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("FTS phrase Getting started hits getting-started.md", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-fts-hyphen-"));
    try {
      await writeKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "getting-started.md",
        content: "# Knowledge vault / 知识库\n\nPersonal notes only.\n",
      });
      const result = await searchKnowledgeVault({
        homeDir: home,
        query: "Getting started",
        scope: "user",
      });
      assert.equal(result.ok, true);
      assert.ok(
        result.hits.some((hit) => hit.relPath === "getting-started.md"),
        `FTS/scan missed hyphenated seed: backend=${result.backend} hits=${JSON.stringify(result.hits)}`,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

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
