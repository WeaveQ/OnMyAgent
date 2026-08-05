/**
 * Config profile path resolve dual-read.
 */
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  dirNonEmpty,
  readLocalConfigMigrationStatus,
  resolveLegacyExpertsPath,
  resolveLegacySkillsPath,
  resolveLocalConfigRoot,
  resolveLocalExpertsProfilePath,
  resolveLocalExpertsRoot,
  resolveLocalManagedToolsBinRoot,
  resolveLocalManagedToolsRoot,
  resolveOfficeCliManagedRoot,
  resolveLocalSkillsProfilePath,
  resolveLocalSkillsRoot,
} from "./config-profile-paths.mjs";

async function withTempHome(fn) {
  const home = await mkdtempSafe();
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function mkdtempSafe() {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), "oma-cfg-paths-"));
}

describe("config-profile-paths", () => {
  test("managed tools use the local profile data root", () => {
    const home = "/Users/hope";
    assert.equal(
      resolveLocalManagedToolsRoot(home),
      path.join(home, ".onmyagent", "profiles", "local", "tools"),
    );
    assert.equal(
      resolveLocalManagedToolsBinRoot(home),
      path.join(home, ".onmyagent", "profiles", "local", "tools", "bin"),
    );
    assert.equal(
      resolveOfficeCliManagedRoot(home),
      path.join(home, ".onmyagent", "profiles", "local", "tools", "officecli"),
    );
  });

  test("local config root is under profiles/local/config", () => {
    const root = resolveLocalConfigRoot("/Users/hope");
    assert.equal(
      root,
      path.join("/Users/hope", ".onmyagent", "profiles", "local", "config"),
    );
  });

  test("resolve skills always uses profile path (no legacy dual-read)", async () => {
    await withTempHome(async (home) => {
      const legacy = resolveLegacySkillsPath(home);
      const profile = resolveLocalSkillsProfilePath(home);
      await mkdir(path.join(legacy, "skill-a"), { recursive: true });
      await writeFile(path.join(legacy, "skill-a", "SKILL.md"), "# a\n");
      // Even with only legacy populated, product root is profile.
      assert.equal(resolveLocalSkillsRoot(home), profile);
    });
  });

  test("resolve skills stays on profile when non-empty", async () => {
    await withTempHome(async (home) => {
      const profile = resolveLocalSkillsProfilePath(home);
      await mkdir(path.join(profile, "skill-b"), { recursive: true });
      await writeFile(path.join(profile, "skill-b", "SKILL.md"), "# b\n");
      assert.equal(resolveLocalSkillsRoot(home), profile);
    });
  });

  test("resolve skills uses profile when migration complete", async () => {
    await withTempHome(async (home) => {
      const configRoot = resolveLocalConfigRoot(home);
      await mkdir(configRoot, { recursive: true });
      await writeFile(
        path.join(configRoot, "manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          profile: "local",
          migration: { status: "complete" },
        }),
      );
      const profile = resolveLocalSkillsProfilePath(home);
      await mkdir(profile, { recursive: true });
      assert.equal(readLocalConfigMigrationStatus(home), "complete");
      assert.equal(resolveLocalSkillsRoot(home), profile);
    });
  });

  test("resolve experts maps marketplace names", async () => {
    await withTempHome(async (home) => {
      assert.equal(
        resolveLocalExpertsProfilePath(home, "experts"),
        path.join(resolveLocalConfigRoot(home), "experts", "installed"),
      );
      assert.equal(
        resolveLocalExpertsProfilePath(home, "my-experts"),
        path.join(resolveLocalConfigRoot(home), "experts", "mine"),
      );
      assert.equal(
        resolveLegacyExpertsPath(home, "experts"),
        path.join(home, ".onmyagent", "marketplaces", "experts"),
      );
      const legacyMine = resolveLegacyExpertsPath(home, "my-experts");
      await mkdir(path.join(legacyMine, "pkg"), { recursive: true });
      assert.equal(resolveLocalExpertsRoot(home, "my-experts"), legacyMine);
    });
  });

  test("dirNonEmpty false for missing or empty", async () => {
    await withTempHome(async (home) => {
      assert.equal(dirNonEmpty(path.join(home, "nope")), false);
      const empty = path.join(home, "empty");
      await mkdir(empty, { recursive: true });
      assert.equal(dirNonEmpty(empty), false);
    });
  });
});
