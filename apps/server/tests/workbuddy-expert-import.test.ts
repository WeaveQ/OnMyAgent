import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  importWorkBuddyExpertPackage,
  inspectWorkBuddyExpertPackage,
  listWorkBuddyExpertPackages,
  previewWorkBuddyExpertImport,
  WorkBuddyImportError,
} from "../src/services/workbuddy-expert-import.js";
import { replaceDirectoriesAtomically } from "../src/services/workbuddy-expert-files.js";
import { listSkills } from "../src/services/skills.js";

let tempRoot = "";
let roots = { sourceRoot: "", expertsRoot: "", skillsRoot: "" };

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-workbuddy-import-"));
  roots = {
    sourceRoot: join(tempRoot, "workbuddy"),
    expertsRoot: join(tempRoot, "onmyagent", "experts"),
    skillsRoot: join(tempRoot, "onmyagent", "skills"),
  };
  await mkdir(roots.sourceRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("WorkBuddy expert import", () => {
  test("lists agents and reconstructs a non-standard team with lead first", async () => {
    await writePackage("developer", {
      name: "developer",
      version: "1.0.0",
      displayName: { zh: "吴八哥", en: "Will" },
      profession: { zh: "高级开发工程师", en: "Senior Developer" },
      expertType: "agent",
      agentName: "developer",
      agents: ["./agents/developer.md"],
      skills: [{ name: "fullstack-dev", path: "./skills/fullstack-dev" }],
    });
    await writePackage("software-company", {
      name: "software-company",
      description: "Software team",
      expertType: "team",
      agentName: "software-team-lead",
      members: [
        { id: "software-engineer", role: "member" },
        { id: "software-team-lead", role: "lead" },
      ],
      teamInfo: {
        leadAgent: "software-team-lead",
        memberAgents: ["software-engineer"],
      },
    }, ["software-team-lead", "software-engineer"]);

    const items = await listWorkBuddyExpertPackages({ roots });
    expect(items).toHaveLength(2);
    const team = await inspectWorkBuddyExpertPackage({ query: "software-company", roots });
    expect(team.expertType).toBe("team");
    expect(team.agents).toEqual(["software-team-lead", "software-engineer"]);
    expect(team.members).toBe(2);

    const localized = await inspectWorkBuddyExpertPackage({ query: "高级开发工程师", roots });
    expect(localized.packageName).toBe("developer");
    expect(localized.skills).toEqual(["fullstack-dev"]);
  });

  test("discovers a package whose source directory is a marketplace alias", async () => {
    await writePackage("git:cloud-ops-team:cloud-ops-team-lead", {
      name: "cloud-ops-team",
      displayName: { zh: "腾讯云技术支持", en: "Cloud Ops Team" },
      expertType: "team",
      agentName: "cloud-ops-team-lead",
      members: [
        { id: "cloud-ops-team-lead", role: "lead" },
        { id: "cloud-architect", role: "member" },
      ],
    }, ["cloud-ops-team-lead", "cloud-architect"]);

    const items = await listWorkBuddyExpertPackages({ kind: "team", roots });
    expect(items.map((item) => item.packageName)).toEqual(["cloud-ops-team"]);

    const inspected = await inspectWorkBuddyExpertPackage({ query: "腾讯云技术支持", roots });
    expect(inspected.packageName).toBe("cloud-ops-team");

    const imported = await importWorkBuddyExpertPackage({ query: "cloud-ops-team", roots });
    expect(imported.destination).toBe(join(roots.expertsRoot, "cloud-ops-team"));
    const manifest = JSON.parse(
      await readFile(join(imported.destination, ".expert-plugin", "plugin.json"), "utf8"),
    );
    expect(manifest.name).toBe("cloud-ops-team");
  });

  test("still rejects an unsafe manifest name from a source directory alias", async () => {
    await writePackage("git:unsafe-alias", {
      name: "../escape",
      expertType: "agent",
      agentName: "safe-agent",
      agents: ["./agents/safe-agent.md"],
    }, ["safe-agent"]);

    const error = await captureError(() => listWorkBuddyExpertPackages({ roots }));
    expect(error).toBeInstanceOf(WorkBuddyImportError);
    expect(error instanceof WorkBuddyImportError ? error.code : "")
      .toBe("workbuddy_manifest_invalid");
    expect(await fileExists(join(tempRoot, "escape"))).toBe(false);
  });

  test("imports, normalizes, materializes skills, and updates idempotently", async () => {
    const source = await writePackage("developer", {
      name: "developer",
      version: "1.0.0",
      profession: { zh: "高级开发工程师", en: "Senior Developer" },
      expertType: "agent",
      agentName: "developer",
      agents: ["./agents/developer.md"],
      skills: ["./skills/fullstack-dev"],
    });

    const first = await importWorkBuddyExpertPackage({ query: "developer", roots });
    expect(first.action).toBe("added");
    expect(first.installedSkills).toEqual(["fullstack-dev"]);
    const manifest = JSON.parse(
      await readFile(join(first.destination, ".expert-plugin", "plugin.json"), "utf8"),
    );
    expect(manifest.importedFrom).toBe("workbuddy");
    expect(manifest.agents).toEqual(["./agents/developer.md"]);
    expect(await readFile(join(first.destination, "skills", "fullstack-dev", "SKILL.md"), "utf8"))
      .toContain("name: fullstack-dev");
    expect(await fileExists(join(roots.skillsRoot, "fullstack-dev", "SKILL.md"))).toBe(false);
    const previous = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
    process.env.OPENCODE_GLOBAL_SKILLS_DIR = roots.skillsRoot;
    try {
      const listed = await listSkills(join(tempRoot, "workspace"), true);
      const importedSkillPath = join(first.destination, "skills", "fullstack-dev", "SKILL.md");
      expect(listed.some((item) => item.path === importedSkillPath)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_GLOBAL_SKILLS_DIR;
      else process.env.OPENCODE_GLOBAL_SKILLS_DIR = previous;
    }

    await writeFile(join(source, "agents", "developer.md"), agentMarkdown("developer", "updated"));
    const second = await importWorkBuddyExpertPackage({ query: "高级开发工程师", roots });
    expect(second.action).toBe("updated");
    expect(await readFile(join(second.destination, "agents", "developer.md"), "utf8"))
      .toContain("updated");
  });

  test("compiles a team manifest and lead prompt into single-lead workflow mode", async () => {
    await writePackage("software-company", {
      name: "software-company",
      expertType: "team",
      agentName: "software-team-lead",
      members: [
        { id: "software-team-lead", role: "lead", profession: { zh: "交付总监", en: "Delivery lead" } },
        { id: "software-product-manager", role: "member", profession: { zh: "产品经理", en: "Product manager" } },
        { id: "software-engineer", role: "member", profession: { zh: "工程师", en: "Engineer" } },
        { id: "software-qa-engineer", role: "member", profession: { zh: "QA工程师", en: "QA engineer" } },
      ],
    }, [
      "software-team-lead",
      "software-product-manager",
      "software-engineer",
      "software-qa-engineer",
    ]);

    const result = await importWorkBuddyExpertPackage({ query: "software-company", roots });
    const manifest = JSON.parse(
      await readFile(join(result.destination, ".expert-plugin", "plugin.json"), "utf8"),
    );
    const leadPrompt = await readFile(
      join(result.destination, "agents", "software-team-lead.md"),
      "utf8",
    );

    expect(manifest.teamWorkflow.mode).toBe("lead-workflow");
    expect(manifest.teamWorkflow.stages.map((stage: { kind: string }) => stage.kind))
      .toEqual(["frame", "produce", "verify", "deliver"]);
    expect(leadPrompt).toContain("single-lead mode");
    expect(leadPrompt).toContain("Never claim that you delegated");
    expect(leadPrompt).not.toContain("independently dispatch each member");
  });

  test("dry-run does not write and reports the planned action", async () => {
    await writePackage("developer", {
      name: "developer",
      expertType: "agent",
      agentName: "developer",
      agents: ["./agents/developer.md"],
    });
    const result = await importWorkBuddyExpertPackage({ query: "developer", roots, dryRun: true });
    expect(result.action).toBe("would-add");
    expect(await fileExists(result.destination)).toBe(false);
  });

  test("does not copy imported skills into the user installed-skills root", async () => {
    await writePackage("developer", {
      name: "developer",
      expertType: "agent",
      agentName: "developer",
      agents: ["./agents/developer.md"],
      skills: ["./skills/fullstack-dev"],
    });
    await mkdir(join(roots.skillsRoot, "fullstack-dev"), { recursive: true });
    await writeFile(join(roots.skillsRoot, "fullstack-dev", "SKILL.md"), "user-owned\n");

    const result = await importWorkBuddyExpertPackage({ query: "developer", roots });
    expect(result.action).toBe("added");
    expect(await fileExists(join(result.destination, ".expert-plugin", "plugin.json"))).toBe(true);
    expect(await readFile(join(roots.skillsRoot, "fullstack-dev", "SKILL.md"), "utf8"))
      .toBe("user-owned\n");
    expect(await readFile(join(result.destination, "skills", "fullstack-dev", "SKILL.md"), "utf8"))
      .toContain("name: fullstack-dev");
  });

  test("rejects package symlinks that escape the WorkBuddy package", async () => {
    const source = await writePackage("developer", {
      name: "developer",
      expertType: "agent",
      agentName: "developer",
      agents: ["./agents/developer.md"],
    });
    const outside = join(tempRoot, "outside.txt");
    await writeFile(outside, "do not copy");
    await symlink(outside, join(source, "outside-link"));

    const error = await captureError(() =>
      importWorkBuddyExpertPackage({ query: "developer", roots }));
    expect(error instanceof Error ? error.message : "").toContain("escapes source root");
    expect(await fileExists(join(roots.expertsRoot, "developer"))).toBe(false);
  });

  test("rejects a referenced agent symlink before reading outside the package", async () => {
    const source = await writePackage("developer", {
      name: "developer",
      expertType: "agent",
      agentName: "developer",
      agents: ["./agents/developer.md"],
    });
    const outside = join(tempRoot, "outside-agent.md");
    await writeFile(outside, "# Outside agent\nprivate content\n");
    await rm(join(source, "agents", "developer.md"));
    await symlink(outside, join(source, "agents", "developer.md"));

    const error = await captureError(() =>
      inspectWorkBuddyExpertPackage({ query: "developer", roots }));
    expect(error instanceof Error ? error.message : "").toContain("escapes source root");
  });

  test("rejects an update token after an owned destination changes", async () => {
    await writePackage("developer", {
      name: "developer",
      expertType: "agent",
      agentName: "developer",
      agents: ["./agents/developer.md"],
    });
    const imported = await importWorkBuddyExpertPackage({ query: "developer", roots });
    const preview = await previewWorkBuddyExpertImport({ query: "developer", roots });
    const installedAgent = join(imported.destination, "agents", "developer.md");
    await writeFile(installedAgent, "# Locally edited expert\n");

    const error = await captureError(() => importWorkBuddyExpertPackage({
      query: "developer",
      roots,
      confirmationToken: preview.confirmationToken,
      requireConfirmation: true,
    }));
    expect(error).toBeInstanceOf(WorkBuddyImportError);
    expect(error instanceof WorkBuddyImportError ? error.code : "")
      .toBe("workbuddy_import_plan_stale");
    expect(await readFile(installedAgent, "utf8")).toBe("# Locally edited expert\n");
  });

  test("rolls back directory replacements when committed verification fails", async () => {
    const destination = join(tempRoot, "destination");
    const staging = join(tempRoot, "staging");
    await mkdir(destination, { recursive: true });
    await mkdir(staging, { recursive: true });
    await writeFile(join(destination, "value.txt"), "original");
    await writeFile(join(staging, "value.txt"), "replacement");

    await expect(replaceDirectoriesAtomically(
      [{ staging, destination }],
      async () => {
        throw new Error("verification failed");
      },
    )).rejects.toThrow("verification failed");
    expect(await readFile(join(destination, "value.txt"), "utf8")).toBe("original");
  });
});

async function writePackage(
  packageName: string,
  manifest: Record<string, unknown>,
  agentNames = [packageName],
): Promise<string> {
  const root = join(roots.sourceRoot, packageName);
  await mkdir(join(root, ".codebuddy-plugin"), { recursive: true });
  await mkdir(join(root, "agents"), { recursive: true });
  await writeFile(
    join(root, ".codebuddy-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const agentName of agentNames) {
    await writeFile(join(root, "agents", `${agentName}.md`), agentMarkdown(agentName, "initial"));
  }
  const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
  for (const skill of skills) {
    const pathValue = typeof skill === "string"
      ? skill
      : skill !== null && typeof skill === "object"
        ? Reflect.get(skill, "path")
        : null;
    if (typeof pathValue !== "string") continue;
    const relative = pathValue.replace(/^\.\//, "");
    const skillName = relative.split("/").at(-1) ?? "";
    await mkdir(join(root, relative), { recursive: true });
    await writeFile(
      join(root, relative, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: imported test skill\n---\n# ${skillName}\n`,
    );
  }
  return root;
}

function agentMarkdown(name: string, detail: string): string {
  return `---\nname: ${name}\ndescription: ${detail}\n---\n# ${name}\n${detail}\n`;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await readFile(target);
    return true;
  } catch {
    return false;
  }
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}
