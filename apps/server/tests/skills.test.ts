import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { listSkills } from "../src/services/skills.js";

let tempRoot = "";
let originalGlobalSkillsDir: string | undefined;
let originalBundledSkillsDir: string | undefined;

async function writeSkill(root: string, name: string, description: string) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${description}\n`,
    "utf8",
  );
}

describe("skills", () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-skills-"));
    originalGlobalSkillsDir = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
    originalBundledSkillsDir = process.env.ONMYAGENT_BUNDLED_SKILLS_DIR;
  });

  afterEach(async () => {
    if (originalGlobalSkillsDir === undefined) {
      delete process.env.OPENCODE_GLOBAL_SKILLS_DIR;
    } else {
      process.env.OPENCODE_GLOBAL_SKILLS_DIR = originalGlobalSkillsDir;
    }
    if (originalBundledSkillsDir === undefined) {
      delete process.env.ONMYAGENT_BUNDLED_SKILLS_DIR;
    } else {
      process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("classifies bundled, OnMyAgent, and local project skills separately", async () => {
    const workspace = join(tempRoot, "workspace");
    const onmyagent = join(tempRoot, "onmyagent-skills");
    const bundled = join(tempRoot, "bundled-skills");

    process.env.OPENCODE_GLOBAL_SKILLS_DIR = onmyagent;
    process.env.ONMYAGENT_BUNDLED_SKILLS_DIR = bundled;

    await writeSkill(join(workspace, ".opencode", "skills"), "local-only", "Local skill");
    await writeSkill(onmyagent, "onmyagent-only", "OnMyAgent skill");
    await writeSkill(bundled, "builtin-only", "Built-in skill");

    const items = await listSkills(workspace, true);
    const scopes = new Map(items.map((item) => [item.name, item.scope]));

    expect(scopes.get("builtin-only")).toBe("built-in");
    expect(scopes.get("onmyagent-only")).toBe("onmyagent");
    expect(scopes.get("local-only")).toBe("local");
  });
});
