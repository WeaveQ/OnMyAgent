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
  it("installs core packages including document processing, pptx, and self-improving", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "oma-skills-"));
    const bundled = path.join(root, "bundled");
    const user = path.join(root, "user");
    for (const name of [
      "expert-manager",
      "create-automation",
      "skill-creator",
      "find-skills",
      "document-processing",
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
      "document-processing",
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
    assert.ok(second.skipped.includes("pptx"));
  });
});
