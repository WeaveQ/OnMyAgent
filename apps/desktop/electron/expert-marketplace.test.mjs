import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createExpertMarketplace } from "./expert-marketplace.mjs";

test("my expert packages preserve role prompt, memory, and selected skills", () => {
  const marketplace = createExpertMarketplace({ getRealHomeDir: () => "/tmp/onmyagent-test-home" });
  const files = marketplace.myExpertPackageFiles({
    name: "Decision coach",
    description: "Helps compare options.",
    rolePrompt: "Ask for constraints before making a recommendation.",
    memory: "Remember the user's preferred risk level.",
    skills: ["research", "planning"],
    introStyle: "short-colleague",
  }, "decision-coach");

  assert.deepEqual(files.plugin.agentConfig, {
    rolePrompt: "Ask for constraints before making a recommendation.",
    memory: "Remember the user's preferred risk level.",
    skillIds: ["research", "planning"],
  });
  assert.deepEqual(files.plugin.skills, ["./skills/research", "./skills/planning"]);
  assert.equal(files.plugin.introStyle, "short-colleague");
  assert.match(files.agentMarkdown, /## 角色提示词/);
  assert.match(files.agentMarkdown, /Ask for constraints/);
  assert.match(files.agentMarkdown, /## 专家记忆/);
  assert.match(files.agentMarkdown, /preferred risk level/);
  assert.match(files.agentMarkdown, /`research`、`planning`/);
});

test("imported team packages expose their single-lead workflow", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-expert-workflow-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".expert-plugin"), { recursive: true });
  await mkdir(join(root, "agents"), { recursive: true });
  await writeFile(join(root, ".expert-plugin", "plugin.json"), JSON.stringify({
    name: "software-company",
    expertType: "team",
    agentName: "software-team-lead",
    agents: ["./agents/software-team-lead.md"],
    teamWorkflow: {
      mode: "lead-workflow",
      version: 1,
      leadAgentName: "software-team-lead",
      memberCount: 3,
      stages: [
        {
          id: "frame",
          kind: "frame",
          title: { zh: "澄清与规划", en: "Frame and plan" },
          description: { zh: "明确目标", en: "Clarify the goal" },
          members: [
            { id: "product-manager", profession: { zh: "产品经理", en: "Product manager" } },
          ],
          deliverables: { zh: ["任务框架"], en: ["Task frame"] },
          checks: { zh: ["目标明确"], en: ["Goal is explicit"] },
        },
      ],
    },
  }));
  await writeFile(join(root, "agents", "software-team-lead.md"), "# Software team lead\n");

  const marketplace = createExpertMarketplace({ getRealHomeDir: () => "/tmp/onmyagent-test-home" });
  const entry = marketplace.expertPackageEntryFromDirectory(root, "software-company", "experts");

  assert.equal(entry.teamWorkflow.mode, "lead-workflow");
  assert.equal(entry.teamWorkflow.stages[0].title, "澄清与规划");
  assert.deepEqual(entry.teamWorkflow.stages[0].members, ["产品经理"]);
});

test("legacy frontmatter skills are a one-train fallback behind manifest ownership", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-legacy-skills-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".expert-plugin"), { recursive: true });
  await mkdir(join(root, "agents"), { recursive: true });
  await writeFile(join(root, ".expert-plugin", "plugin.json"), JSON.stringify({
    name: "legacy-expert",
    agents: ["./agents/legacy-expert.md"],
  }));
  await writeFile(join(root, "agents", "legacy-expert.md"), [
    "---",
    "name: legacy-expert",
    "skills:",
    "  - ./skills/legacy-one",
    "  - legacy-two",
    "---",
    "# Legacy expert",
  ].join("\n"));

  const marketplace = createExpertMarketplace({ getRealHomeDir: () => "/tmp/onmyagent-test-home" });
  const fallbackEntry = marketplace.expertPackageEntryFromDirectory(root, "legacy-expert", "experts");
  assert.deepEqual(fallbackEntry.skills, ["legacy-one", "legacy-two"]);
  const persisted = JSON.parse(await readFile(join(root, ".expert-plugin", "plugin.json"), "utf8"));
  assert.ok(Object.prototype.hasOwnProperty.call(persisted, "skills"));
  assert.deepEqual(persisted.skills, ["./skills/legacy-one", "./skills/legacy-two"]);

  await writeFile(join(root, ".expert-plugin", "plugin.json"), JSON.stringify({
    name: "legacy-expert",
    agents: ["./agents/legacy-expert.md"],
    skills: [],
  }));
  const manifestEntry = marketplace.expertPackageEntryFromDirectory(root, "legacy-expert", "experts");
  assert.deepEqual(manifestEntry.skills, []);
});
