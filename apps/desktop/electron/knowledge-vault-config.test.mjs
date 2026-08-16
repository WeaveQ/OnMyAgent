import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  readKnowledgeConfig,
  validatePersonalVaultPath,
  writePersonalVaultPath,
} from "./knowledge-vault-config.mjs";
import { ensureKnowledgeVault } from "./ensure-knowledge-vault.mjs";
import { GETTING_STARTED_REL_PATH } from "./knowledge-vault-paths.mjs";
import { listKnowledgeVault } from "./knowledge-vault-io.mjs";

describe("personal vault path override", () => {
  test("rejects the knowledge root and accepts an external folder", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-cfg-"));
    try {
      await ensureKnowledgeVault({ homeDir: home });
      const root = path.join(home, ".onmyagent", "data", "user", "knowledge");
      assert.equal(validatePersonalVaultPath(root, home).ok, false);
      assert.equal(validatePersonalVaultPath("relative/notes", home).ok, false);

      const external = path.join(home, "ObsidianVault");
      await mkdir(external, { recursive: true });
      await writeFile(path.join(external, "daily.md"), "# Daily\n", "utf8");
      await mkdir(path.join(external, ".obsidian"), { recursive: true });
      await writeFile(path.join(external, ".obsidian", "app.json"), "{}\n", "utf8");

      const set = await writePersonalVaultPath(external, home);
      assert.equal(set.ok, true);
      assert.equal(set.usingDefault, false);
      assert.equal(set.resolvedUserVaultDir, external);

      const listed = await listKnowledgeVault({ homeDir: home, scope: "user" });
      assert.ok(listed.scopes[0].files.some((file) => file.relPath === "daily.md"));
      assert.ok(!listed.scopes[0].files.some((file) => file.relPath.includes(".obsidian")));
      assert.ok(
        !listed.scopes[0].files.some((file) => file.relPath === GETTING_STARTED_REL_PATH),
      );
      assert.equal(listed.scopes[0].path, external);

      const remembered = readKnowledgeConfig(home);
      assert.equal(remembered.vaults.some((item) => item.path === external), true);

      const reset = await writePersonalVaultPath(null, home);
      assert.equal(reset.usingDefault, true);
      assert.equal(readKnowledgeConfig(home).usingDefault, true);
      assert.equal(
        readKnowledgeConfig(home).vaults.some((item) => item.path === external),
        true,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
