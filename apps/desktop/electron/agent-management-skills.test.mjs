/**
 * Skill inventory: product roots stay intact; managed fleet nativeSkillsDirs
 * are scanned and tagged to the agent matrix key (not forced to "unknown").
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentManagementSkills } from "./agent-management-skills.mjs";

async function withTempHome(run) {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-skill-scan-"));
  try {
    return await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function createSkillsApi(home) {
  return createAgentManagementSkills({
    getRealHomeDir: () => home,
    onmyagentUserSkillsRoot: () => path.join(home, ".onmyagent", "skills"),
    bundledSkillsRootPath: () => null,
    shell: {
      openPath: async () => "",
      showItemInFolder: () => {},
    },
  });
}

async function writeSkillPackage(root, name, body = "# skill\n") {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
  return dir;
}

describe("agent-management-skills fleet native roots", () => {
  it("collects managed nativeSkillsDirs and tags skills to the agent key", async () => {
    await withTempHome(async (home) => {
      const api = createSkillsApi(home);
      const productRoot = path.join(home, ".claude", "skills");
      const managedRoot = path.join(home, "managed-agent-skills");
      await writeSkillPackage(productRoot, "product-claude-skill");
      await writeSkillPackage(managedRoot, "managed-wb-skill");

      const fleetAgents = [
        {
          id: "workbuddy",
          provider: "custom",
          name: "WorkBuddy",
          nativeSkillsDirs: [managedRoot],
        },
      ];

      const roots = await api.collectAgentSkillRoots(path.join(home, "ws"), fleetAgents);
      assert.ok(
        roots.some(
          (root) =>
            root.agent === "workbuddy"
            && path.resolve(root.root) === path.resolve(managedRoot)
            && root.scope === "native",
        ),
        "managed native root must appear for workbuddy",
      );
      assert.ok(
        roots.some((root) => root.agent === "claude" && root.root.includes(`${path.sep}.claude${path.sep}skills`)),
        "product Claude root remains",
      );

      const skills = await api.scanAgentManagementSkills(path.join(home, "ws"), { fleetAgents });
      const managed = skills.find((skill) => skill.name === "managed-wb-skill");
      assert.ok(managed, "managed skill is scanned");
      assert.ok(
        managed.agents.includes("workbuddy"),
        `expected workbuddy tag, got ${JSON.stringify(managed.agents)}`,
      );
      assert.equal(managed.agents.includes("unknown") && managed.agents.length === 1, false);

      const product = skills.find((skill) => skill.name === "product-claude-skill");
      assert.ok(product, "product skill is scanned");
      assert.ok(
        product.agents.includes("claude"),
        `expected claude tag, got ${JSON.stringify(product.agents)}`,
      );
    });
  });

  it("uniqueAgentList keeps catalog keys; skillMatrixAgentKey prefers id for custom", async () => {
    await withTempHome(async (home) => {
      const api = createSkillsApi(home);
      assert.deepEqual(
        api.uniqueAgentList(["workbuddy", "claude", "workbuddy", "unknown"]),
        ["claude", "unknown", "workbuddy"],
      );
      assert.equal(
        api.skillMatrixAgentKey({ id: "workbuddy", provider: "custom" }),
        "workbuddy",
      );
      assert.equal(
        api.skillMatrixAgentKey({ id: "claude-local", provider: "claude" }),
        "claude",
      );
      assert.deepEqual(
        api.skillAgentsFromPath({
          path: path.join(home, ".claude", "skills", "x"),
          root: path.join(home, ".claude", "skills"),
        }),
        ["claude"],
      );
      assert.ok(
        api
          .skillAgentsFromPath({
            path: path.join(home, ".workbuddy", "skills", "x"),
            root: path.join(home, ".workbuddy", "skills"),
          })
          .includes("workbuddy"),
      );
    });
  });
});
