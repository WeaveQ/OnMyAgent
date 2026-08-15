import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializeExpertSessionSkills } from "../src/services/expert-session-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  const previousExperts = process.env.ONMYAGENT_EXPERTS_DIR;
  const previousGlobal = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  delete process.env.ONMYAGENT_EXPERTS_DIR;
  delete process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  if (previousExperts !== undefined) process.env.ONMYAGENT_EXPERTS_DIR = previousExperts;
  if (previousGlobal !== undefined) process.env.OPENCODE_GLOBAL_SKILLS_DIR = previousGlobal;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("skill-role same-name collision", () => {
  test("isolation writes the expert tree; user installed X is unmodified", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "skill-role-collision-"));
    roots.push(fixture);
    const userRoot = join(fixture, "user-skills");
    const expertsDir = join(fixture, "experts");
    const sessionDir = join(fixture, "session");
    await mkdir(join(userRoot, "shared-name"), { recursive: true });
    await writeFile(join(userRoot, "shared-name", "SKILL.md"), "---\nname: shared-name\n---\nUSER COPY\n");
    await writeFile(join(userRoot, "shared-name", "user-only.txt"), "keep-me\n");
    await mkdir(join(expertsDir, "demo-expert", "skills", "shared-name"), { recursive: true });
    await writeFile(
      join(expertsDir, "demo-expert", "skills", "shared-name", "SKILL.md"),
      "---\nname: shared-name\n---\nEXPERT COPY\n",
    );

    process.env.ONMYAGENT_EXPERTS_DIR = expertsDir;
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = userRoot;

    const installed = await materializeExpertSessionSkills({
      skillNames: ["shared-name"],
      targetDirectory: sessionDir,
      packageName: "demo-expert",
    });
    expect(installed).toEqual(["shared-name"]);

    const sessionBody = await readFile(
      join(sessionDir, ".opencode", "skills", "shared-name", "SKILL.md"),
      "utf8",
    );
    expect(sessionBody).toContain("EXPERT COPY");
    expect(sessionBody).not.toContain("USER COPY");

    const userBody = await readFile(join(userRoot, "shared-name", "SKILL.md"), "utf8");
    expect(userBody).toContain("USER COPY");
    expect(await readFile(join(userRoot, "shared-name", "user-only.txt"), "utf8")).toBe("keep-me\n");
  });
});
