/**
 * skill-creator write-root e2e (no live model, no OpenCode process).
 *
 * Handbook / bundled skill-creator: finish line is
 * ~/.onmyagent/profiles/local/config/skills/<name>/SKILL.md
 * Logged-out must not create profiles/company or write ~/.onmyagent/skills.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, describe, test } from "node:test";

import { shouldCallCompany, readCompanySettings } from "../company-client.mjs";
import {
  resolveCompanyConfigRoot,
  resolveLegacySkillsPath,
  resolveLocalSkillsRoot,
} from "../config-profile-paths.mjs";
import { ensureLocalConfigMigrated } from "../ensure-local-config-migrated.mjs";
import { createDesktopE2eSandbox } from "./sandbox.mjs";

const roots = [];

after(async () => {
  while (roots.length) {
    await rm(roots.pop(), { recursive: true, force: true });
  }
});

describe("desktop local skill-creator root e2e", () => {
  test("new skill writes under profiles/local/config/skills, not company or legacy", async () => {
    const sandbox = await createDesktopE2eSandbox({
      prefix: "oma-desktop-skill-root-e2e-",
    });
    roots.push(sandbox.root);

    const migrated = await ensureLocalConfigMigrated({
      homeDir: sandbox.realHome,
      appVersion: "e2e",
    });
    assert.equal(migrated.ok, true);

    const skillRoot = resolveLocalSkillsRoot(sandbox.realHome);
    assert.ok(
      skillRoot.endsWith(path.join("profiles", "local", "config", "skills")),
      `unexpected skills root: ${skillRoot}`,
    );

    const skillDir = path.join(skillRoot, "e2e-real-case");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: e2e-real-case\ndescription: planted by desktop e2e\n---\n\n# e2e-real-case\n",
      "utf8",
    );

    assert.equal(existsSync(path.join(skillDir, "SKILL.md")), true);
    assert.equal(existsSync(resolveLegacySkillsPath(sandbox.realHome)), false);
    assert.equal(existsSync(resolveCompanyConfigRoot(sandbox.realHome)), false);
    assert.equal(shouldCallCompany(readCompanySettings(sandbox.realHome)), false);
  });
});
