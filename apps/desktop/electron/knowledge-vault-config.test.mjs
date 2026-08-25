import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  addVault,
  readKnowledgeConfig,
  removeVault,
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

  test("addVault appends, dedupes by path, and rejects missing/default", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-add-"));
    try {
      await ensureKnowledgeVault({ homeDir: home });
      const defaultPath = readKnowledgeConfig(home).resolvedUserVaultDir;

      const one = path.join(home, "VaultOne");
      const two = path.join(home, "VaultTwo");
      await mkdir(one, { recursive: true });
      await mkdir(two, { recursive: true });

      const added = await addVault(home, { name: "One", path: one });
      assert.equal(added.ok, true);
      assert.equal(added.vaults.some((v) => v.path === one), true);
      assert.equal(added.usingDefault, true, "addVault does not change active vault");

      // Duplicate path is a no-op (same length, same entry wins).
      const deduped = await addVault(home, { name: "Renamed", path: one });
      assert.equal(deduped.ok, true);
      assert.equal(deduped.vaults.filter((v) => v.path === one).length, 1);
      assert.equal(
        deduped.vaults.find((v) => v.path === one)?.name,
        "One",
        "dedupe preserves the existing entry",
      );

      // Missing directory is rejected.
      const missing = await addVault(home, { path: path.join(home, "nope") });
      assert.equal(missing.ok, false);
      assert.equal(missing.reason, "not_found");

      // Default vault cannot be added as an extra entry.
      const blockedDefault = await addVault(home, { path: defaultPath });
      assert.equal(blockedDefault.ok, false);
      assert.equal(blockedDefault.reason, "reserved_default");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("removeVault drops non-default vaults and resets active selection", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-rm-"));
    try {
      await ensureKnowledgeVault({ homeDir: home });
      const defaultPath = readKnowledgeConfig(home).resolvedUserVaultDir;
      const one = path.join(home, "RmOne");
      const two = path.join(home, "RmTwo");
      await mkdir(one, { recursive: true });
      await mkdir(two, { recursive: true });
      await addVault(home, { name: "One", path: one });
      await addVault(home, { name: "Two", path: two });

      // Removing the default is rejected.
      const blockedDefault = await removeVault(home, defaultPath);
      assert.equal(blockedDefault.ok, false);
      assert.equal(blockedDefault.reason, "reserved_default");

      // Removing an unknown path is rejected.
      const notFound = await removeVault(home, path.join(home, "ghost"));
      assert.equal(notFound.ok, false);
      assert.equal(notFound.reason, "not_found");

      // Activate `one` then remove it: selection resets to default.
      const activated = await writePersonalVaultPath(one, home);
      assert.equal(activated.resolvedUserVaultDir, one);
      const removedActive = await removeVault(home, one);
      assert.equal(removedActive.ok, true);
      assert.equal(removedActive.usingDefault, true);
      assert.equal(removedActive.resolvedUserVaultDir, defaultPath);
      assert.equal(removedActive.vaults.some((v) => v.path === one), false);
      assert.equal(removedActive.vaults.some((v) => v.path === two), true);

      // Removing an inactive vault leaves selection untouched.
      const activatedTwo = await writePersonalVaultPath(two, home);
      assert.equal(activatedTwo.resolvedUserVaultDir, two);
      const removedInactive = await removeVault(home, two);
      assert.equal(removedInactive.ok, true);
      assert.equal(removedInactive.usingDefault, true);
      assert.equal(removedInactive.personalVaultPath, null);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
