import { afterEach, describe, expect, test } from "bun:test";
import { cp, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createSkillsDomainHandlers } from "../../desktop/electron/desktop-handlers/skills.mjs";
import { listSkills } from "../src/services/skills.js";
import { createExpertSessionRuntimeDirectory } from "../src/services/expert-session-runtime.js";

const cpAsync = promisify(cp);

const roots: string[] = [];

afterEach(async () => {
  delete process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  delete process.env.ONMYAGENT_EXPERTS_DIR;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeSkill(dir: string, name: string, body: string) {
  const skillDir = join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${body}\n---\n${body}\n`,
  );
}

describe("skill-role install vs 已安装", () => {
  test("installExpertPackage does not add declared skills to the listSkills onmyagent bucket", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "skill-role-install-"));
    roots.push(fixture);
    const builtinRoot = join(fixture, "builtin", "demo-expert");
    const skillsRoot = join(fixture, "user-skills");
    const marketplace = join(fixture, "marketplace");
    const workspace = join(fixture, "workspace");
    await mkdir(skillsRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(join(builtinRoot, ".expert-plugin"), { recursive: true });
    await writeSkill(join(builtinRoot, "skills"), "expert-only-skill", "expert body");
    await writeFile(
      join(builtinRoot, ".expert-plugin", "plugin.json"),
      JSON.stringify({ skills: ["./skills/expert-only-skill"] }),
    );
    await writeSkill(skillsRoot, "user-hub-skill", "personal install");

    const handlers = createSkillsDomainHandlers({
      mkdir,
      rm,
      writeFile,
      readFile,
      path: await import("node:path"),
      existsSync,
      onmyagentUserSkillsRoot: () => skillsRoot,
      onmyagentMarketplaceRoot: (name: string) => join(marketplace, name),
      validateExpertMarketplaceName: (value: string) => String(value),
      validateExpertPackageName: (value: string) => String(value),
      builtinExpertPackageSource: (name: string) => ({
        safePackage: name,
        candidates: [join(fixture, "builtin", name)],
      }),
      copyDirectoryRecursive: async (src: string, dest: string) => {
        await mkdir(join(dest, ".."), { recursive: true });
        await cpAsync(src, dest, { recursive: true });
      },
      refreshRuntimeSkillLinks: async () => undefined,
    });

    const installed = await handlers.installExpertPackage({}, [{
      source: "builtin",
      marketplace: "experts",
      packageName: "demo-expert",
    }]);
    expect(installed.ok).toBe(true);
    expect(installed.declaredSkills).toContain("expert-only-skill");
    expect(installed.installedSkills).toEqual([]);

    process.env.OPENCODE_GLOBAL_SKILLS_DIR = skillsRoot;
    const afterInstall = await listSkills(workspace, true);
    const onmyagentNames = afterInstall
      .filter((item) => item.scope === "onmyagent")
      .map((item) => item.name);
    expect(onmyagentNames).toContain("user-hub-skill");
    expect(onmyagentNames).not.toContain("expert-only-skill");

    process.env.ONMYAGENT_EXPERTS_DIR = join(marketplace, "experts");
    const session = await createExpertSessionRuntimeDirectory({
      workspace: {
        id: "ws",
        name: "ws",
        path: workspace,
        preset: "default",
        workspaceType: "local",
      },
      runtimeRoot: join(fixture, "expert-sessions"),
      agentName: "demo",
      agentId: "demo-expert",
      packageName: "demo-expert",
      sessionKey: "skill-role-1",
      skillNames: ["expert-only-skill"],
    });
    expect(session.installedSkills).toEqual(["expert-only-skill"]);
    expect(existsSync(join(session.directory, ".opencode", "skills", "expert-only-skill", "SKILL.md"))).toBe(true);

    await handlers.uninstallExpertPackage({}, [{
      marketplace: "experts",
      packageName: "demo-expert",
    }]);
    const afterUninstall = await listSkills(workspace, true);
    expect(afterUninstall.filter((item) => item.scope === "onmyagent").map((item) => item.name)).toEqual(
      onmyagentNames,
    );
  });
});
