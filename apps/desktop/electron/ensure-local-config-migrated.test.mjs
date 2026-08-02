/**
 * Local config migration: copy skills + experts; never delete legacy.
 */
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  readLocalConfigMigrationStatus,
  resolveLegacyExpertsPath,
  resolveLegacySkillsPath,
  resolveLocalConfigManifestPath,
  resolveLocalExpertsProfilePath,
  resolveLocalSkillsProfilePath,
  resolveLocalSkillsRoot,
} from "./config-profile-paths.mjs";
import { ensureLocalConfigMigrated } from "./ensure-local-config-migrated.mjs";

async function withTempHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-cfg-mig-"));
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function seedLegacy(home) {
  const skillDir = path.join(resolveLegacySkillsPath(home), "demo-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), "# demo skill\n");

  const expertsDir = path.join(
    resolveLegacyExpertsPath(home, "experts"),
    "demo-expert",
  );
  await mkdir(expertsDir, { recursive: true });
  await writeFile(path.join(expertsDir, "package.json"), '{"name":"demo"}\n');

  const mineDir = path.join(
    resolveLegacyExpertsPath(home, "my-experts"),
    "my-demo",
  );
  await mkdir(mineDir, { recursive: true });
  await writeFile(path.join(mineDir, "package.json"), '{"name":"mine"}\n');
}

describe("ensureLocalConfigMigrated", () => {
  test("copies legacy skills and experts; keeps legacy trees", async () => {
    await withTempHome(async (home) => {
      await seedLegacy(home);

      const result = await ensureLocalConfigMigrated({ homeDir: home });
      assert.equal(result.ok, true);
      assert.equal(result.status, "complete");
      assert.equal(result.skipped, false);
      assert.ok(result.copied.includes("skills"));
      assert.ok(result.copied.includes("experts/installed"));
      assert.ok(result.copied.includes("experts/mine"));

      const profileSkill = path.join(
        resolveLocalSkillsProfilePath(home),
        "demo-skill",
        "SKILL.md",
      );
      const body = await readFile(profileSkill, "utf8");
      assert.equal(body, "# demo skill\n");

      const profileExpert = path.join(
        resolveLocalExpertsProfilePath(home, "experts"),
        "demo-expert",
        "package.json",
      );
      await access(profileExpert);

      // Legacy retained
      await access(
        path.join(resolveLegacySkillsPath(home), "demo-skill", "SKILL.md"),
      );
      await access(
        path.join(
          resolveLegacyExpertsPath(home, "experts"),
          "demo-expert",
          "package.json",
        ),
      );

      assert.equal(readLocalConfigMigrationStatus(home), "complete");
      assert.equal(
        resolveLocalSkillsRoot(home),
        resolveLocalSkillsProfilePath(home),
      );

      const manifest = JSON.parse(
        await readFile(resolveLocalConfigManifestPath(home), "utf8"),
      );
      assert.equal(manifest.migration.status, "complete");
    });
  });

  test("second run is idempotent skip", async () => {
    await withTempHome(async (home) => {
      await seedLegacy(home);
      const first = await ensureLocalConfigMigrated({ homeDir: home });
      assert.equal(first.skipped, false);
      const second = await ensureLocalConfigMigrated({ homeDir: home });
      assert.equal(second.ok, true);
      assert.equal(second.skipped, true);
      assert.equal(second.status, "complete");
      assert.deepEqual(second.copied, []);
    });
  });

  test("fresh home with no legacy still completes empty profile tree", async () => {
    await withTempHome(async (home) => {
      const result = await ensureLocalConfigMigrated({ homeDir: home });
      assert.equal(result.ok, true);
      assert.equal(result.status, "complete");
      assert.equal(readLocalConfigMigrationStatus(home), "complete");
      // Profile skills root preferred after complete even if empty
      assert.equal(
        resolveLocalSkillsRoot(home),
        resolveLocalSkillsProfilePath(home),
      );
    });
  });

  test("failed migrate marks failed and resolve falls back when profile empty", async () => {
    await withTempHome(async (home) => {
      await seedLegacy(home);
      const boom = new Error("disk full");
      const result = await ensureLocalConfigMigrated({
        homeDir: home,
        // Fail during first write of pending manifest after mkdirs... use cp throw
        cp: async () => {
          throw boom;
        },
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, "failed");
      assert.equal(readLocalConfigMigrationStatus(home), "failed");
      // Profile skills may be empty dirs only → dual-read legacy
      assert.equal(resolveLocalSkillsRoot(home), resolveLegacySkillsPath(home));
      // Legacy still present
      await access(
        path.join(resolveLegacySkillsPath(home), "demo-skill", "SKILL.md"),
      );
    });
  });
});
