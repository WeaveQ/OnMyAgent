import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { ensureKnowledgeVault } from "./ensure-knowledge-vault.mjs";
import {
  deleteKnowledgeFile,
  listKnowledgeVault,
  readKnowledgeFile,
  searchKnowledgeVault,
  writeKnowledgeFile,
} from "./knowledge-vault-io.mjs";
import { GETTING_STARTED_REL_PATH } from "./knowledge-vault-paths.mjs";

describe("knowledge vault io", () => {
  test("lists seed note and rejects path traversal", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-io-"));
    try {
      await ensureKnowledgeVault({ homeDir: home });
      const listed = await listKnowledgeVault({ homeDir: home, scope: "user" });
      assert.equal(listed.ok, true);
      assert.ok(
        listed.scopes[0].files.some((file) => file.relPath === GETTING_STARTED_REL_PATH),
      );

      await assert.rejects(
        () => readKnowledgeFile({ homeDir: home, relPath: "../secrets.md" }),
        /invalid_path/,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("writes and searches markdown; skips raw xlsx", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-search-"));
    try {
      await writeKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "briefs/q3.md",
        content: "# Q3 brief\n\nLaunch the autumn campaign in October.\n",
      });
      const vault = path.join(
        home,
        ".onmyagent",
        "data",
        "user",
        "knowledge",
        "vault",
      );
      await mkdir(vault, { recursive: true });
      await writeFile(path.join(vault, "sheet.xlsx"), "not-a-workbook", "utf8");

      const listed = await listKnowledgeVault({ homeDir: home, scope: "user" });
      const xlsx = listed.scopes[0].files.find((file) => file.relPath === "sheet.xlsx");
      assert.equal(xlsx?.indexable, false);

      const unsupported = await readKnowledgeFile({
        homeDir: home,
        relPath: "sheet.xlsx",
      });
      assert.equal(unsupported.ok, false);
      assert.equal(unsupported.reason, "unsupported_type");

      const found = await searchKnowledgeVault({
        homeDir: home,
        query: "autumn campaign",
        scope: "user",
      });
      assert.equal(found.ok, true);
      assert.ok(found.hits.some((hit) => hit.relPath === "briefs/q3.md"));
      assert.ok(!found.hits.some((hit) => hit.relPath.endsWith(".xlsx")));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("keeps project and expert notes in separate folders", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-scope-"));
    try {
      await writeKnowledgeFile({
        homeDir: home,
        scope: "project",
        workspaceId: "ws_local",
        relPath: "roadmap.md",
        content: "# Roadmap\n\nShip vault v1.\n",
      });
      await writeKnowledgeFile({
        homeDir: home,
        scope: "expert",
        expertId: "ops-specialist",
        relPath: "playbook.md",
        content: "# Playbook\n\nExpert-only briefing.\n",
      });

      const listed = await listKnowledgeVault({
        homeDir: home,
        scope: "all",
        workspaceId: "ws_local",
        expertId: "ops-specialist",
      });
      const byScope = Object.fromEntries(
        listed.scopes.map((item) => [item.scope, item.files.map((file) => file.relPath)]),
      );
      assert.ok(byScope.user.includes(GETTING_STARTED_REL_PATH));
      assert.deepEqual(byScope.project, ["roadmap.md"]);
      assert.deepEqual(byScope.expert, ["playbook.md"]);

      const projectBody = await readFile(
        path.join(
          home,
          ".onmyagent",
          "data",
          "user",
          "knowledge",
          "projects",
          "ws_local",
          "roadmap.md",
        ),
        "utf8",
      );
      assert.match(projectBody, /Ship vault v1/);

      await deleteKnowledgeFile({
        homeDir: home,
        scope: "expert",
        expertId: "ops-specialist",
        relPath: "playbook.md",
      });
      const after = await listKnowledgeVault({
        homeDir: home,
        scope: "expert",
        expertId: "ops-specialist",
      });
      assert.deepEqual(after.scopes[0].files, []);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("refuses to delete getting-started and invalidates the index after a real delete", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-del-"));
    try {
      await writeKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "temp.md",
        content: "# Temp\n\nremove me after index.\n",
      });
      const first = await searchKnowledgeVault({
        homeDir: home,
        query: "remove me",
        scope: "user",
      });
      assert.equal(first.index, "rebuilt");

      const blocked = await deleteKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: GETTING_STARTED_REL_PATH,
      });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.reason, "protected");

      const removed = await deleteKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "temp.md",
      });
      assert.equal(removed.ok, true);
      const after = await searchKnowledgeVault({
        homeDir: home,
        query: "remove me",
        scope: "user",
      });
      assert.equal(after.index, "rebuilt");
      assert.equal(after.hits.some((hit) => hit.relPath === "temp.md"), false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
