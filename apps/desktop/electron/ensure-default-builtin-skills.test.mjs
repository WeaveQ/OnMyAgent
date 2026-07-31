import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ensureDefaultBuiltinSkills } from "./ensure-default-builtin-skills.mjs";

async function writeSkill(dir, name) {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: test\n---\n# ${name}\n`,
    "utf8",
  );
  return skillDir;
}

describe("ensureDefaultBuiltinSkills", () => {
  it("installs core packages including find-skills, pptx, self-improving", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "oma-skills-"));
    const bundled = path.join(root, "bundled");
    const user = path.join(root, "user");
    for (const name of [
      "expert-manager",
      "create-automation",
      "skill-creator",
      "find-skills",
      "pptx",
      "self-improving",
      "weather",
    ]) {
      await writeSkill(bundled, name);
    }

    const result = await ensureDefaultBuiltinSkills({
      bundledRoot: bundled,
      userSkillsRoot: user,
    });

    assert.equal(result.ok, true);
    for (const name of [
      "expert-manager",
      "create-automation",
      "skill-creator",
      "find-skills",
      "pptx",
      "self-improving",
    ]) {
      assert.ok(result.installed.includes(name), `should install ${name}`);
      const md = await readFile(path.join(user, name, "SKILL.md"), "utf8");
      assert.match(md, new RegExp(`name: ${name}`));
    }
    assert.equal(result.installed.includes("weather"), false);

    const second = await ensureDefaultBuiltinSkills({
      bundledRoot: bundled,
      userSkillsRoot: user,
    });
    assert.deepEqual(second.installed, []);
    // Core packages re-sync SKILL.md on subsequent boots.
    assert.ok(second.refreshed.includes("pptx"));
    assert.ok(second.refreshed.includes("find-skills"));
    assert.equal(second.skipped.includes("pptx"), false);
  });

  it("refreshes stale SKILL.md for existing core installs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "oma-skills-refresh-"));
    const bundled = path.join(root, "bundled");
    const user = path.join(root, "user");
    await writeSkill(bundled, "find-skills");
    await writeFile(
      path.join(bundled, "find-skills", "SKILL.md"),
      "---\nname: find-skills\ndescription_en: Discover installed skills\ndisplay_name_en: Find Skills\n---\n# Find Skills\n",
      "utf8",
    );
    await mkdir(path.join(user, "find-skills"), { recursive: true });
    await writeFile(
      path.join(user, "find-skills", "SKILL.md"),
      "---\nname: find-skills\ndescription_zh: >-\n---\n# old\n",
      "utf8",
    );

    const result = await ensureDefaultBuiltinSkills({
      bundledRoot: bundled,
      userSkillsRoot: user,
      coreSkills: [{ packageName: "find-skills", skillName: "find-skills" }],
    });
    assert.ok(result.refreshed.includes("find-skills"));
    const md = await readFile(path.join(user, "find-skills", "SKILL.md"), "utf8");
    assert.match(md, /Discover installed skills/);
    assert.doesNotMatch(md, /description_zh: >-/);
  });
});
