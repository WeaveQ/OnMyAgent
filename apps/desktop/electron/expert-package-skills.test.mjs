/**
 * Expert package skills materialize into ~/.onmyagent/skills for load_skill.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  listExpertPackageSkillSources,
  materializeExpertPackageSkills,
} from "./expert-package-skills.mjs";

async function withTempDir(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-expert-skills-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeExpertPackage(packageDir, skillName = "order-entry") {
  await mkdir(path.join(packageDir, ".onmyagent-plugin"), { recursive: true });
  await mkdir(path.join(packageDir, "skills", skillName), { recursive: true });
  await writeFile(
    path.join(packageDir, ".onmyagent-plugin", "plugin.json"),
    `${JSON.stringify({
      name: "order-entry-clerk",
      skills: [`./skills/${skillName}`],
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageDir, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: test skill for expert package\n---\n\n# ${skillName}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageDir, "skills", skillName, "notes.txt"),
    "asset\n",
    "utf8",
  );
}

describe("expert-package-skills", () => {
  it("lists skill sources from plugin.json", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "order-entry-clerk");
      await writeExpertPackage(packageDir);
      const sources = await listExpertPackageSkillSources(packageDir);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].skillName, "order-entry");
      assert.ok(sources[0].sourceDir.endsWith(`${path.sep}order-entry`));
    });
  });

  it("materializes expert skills into the user skills root", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "order-entry-clerk");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      await writeExpertPackage(packageDir);
      const installed = await materializeExpertPackageSkills({
        packageDir,
        skillsRoot,
      });
      assert.deepEqual(installed, ["order-entry"]);
      const skillMd = path.join(skillsRoot, "order-entry", "SKILL.md");
      assert.equal(existsSync(skillMd), true);
      const content = await readFile(skillMd, "utf8");
      assert.match(content, /name: order-entry/);
      assert.equal(
        existsSync(path.join(skillsRoot, "order-entry", "notes.txt")),
        true,
      );
    });
  });

  it("skips skills whose frontmatter name does not match the folder", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "broken");
      await mkdir(path.join(packageDir, ".expert-plugin"), { recursive: true });
      await mkdir(path.join(packageDir, "skills", "foo"), { recursive: true });
      await writeFile(
        path.join(packageDir, ".expert-plugin", "plugin.json"),
        JSON.stringify({ skills: ["./skills/foo"] }),
        "utf8",
      );
      await writeFile(
        path.join(packageDir, "skills", "foo", "SKILL.md"),
        "---\nname: bar\ndescription: mismatch\n---\n",
        "utf8",
      );
      const sources = await listExpertPackageSkillSources(packageDir);
      assert.deepEqual(sources, []);
    });
  });
});
