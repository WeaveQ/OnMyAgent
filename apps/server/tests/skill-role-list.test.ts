import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listSkills } from "../src/services/skills.js";

const roots: string[] = [];

afterEach(async () => {
  const previous = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  delete process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  if (previous !== undefined) process.env.OPENCODE_GLOBAL_SKILLS_DIR = previous;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeSkill(root: string, name: string, body: string) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n${body}\n`);
}

describe("skill-role default listSkills", () => {
  test("lists profile and workspace skills but not ~/.claude or ~/.agents", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "skill-role-list-"));
    roots.push(fixture);
    const profile = join(fixture, "profile-skills");
    const workspace = join(fixture, "workspace");
    const home = join(fixture, "home");
    await writeSkill(profile, "hub-skill", "from profile");
    await writeSkill(join(workspace, ".opencode", "skills"), "ws-skill", "from workspace");
    await writeSkill(join(home, ".claude", "skills"), "claude-skill", "from claude");
    await writeSkill(join(home, ".agents", "skills"), "agents-skill", "from agents");
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = profile;

    const items = await listSkills(workspace, true);
    const names = new Set(items.map((item) => item.name));
    expect(names.has("hub-skill")).toBe(true);
    expect(names.has("ws-skill")).toBe(true);
    expect(names.has("claude-skill")).toBe(false);
    expect(names.has("agents-skill")).toBe(false);
  });
});
