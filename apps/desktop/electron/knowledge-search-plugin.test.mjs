import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  executeKnowledgeSearch,
  installKnowledgeSearchPlugin,
  renderKnowledgePropertyPluginSource,
  renderKnowledgeReadPluginSource,
  renderKnowledgeSearchPluginSource,
} from "./knowledge-search-plugin.mjs";
import {
  writeKnowledgeFile,
  writeKnowledgeSessionDefaults,
} from "./knowledge-vault-io.mjs";
import { resolveKnowledgeRoot } from "./knowledge-vault-paths.mjs";

describe("knowledge_search plugin", () => {
  test("source is a tool plugin, not a skill", () => {
    const source = renderKnowledgeSearchPluginSource("/tmp/knowledge");
    assert.match(source, /export default async \(\) => \(\{/);
    assert.match(source, /knowledge_search: tool\(/);
    assert.doesNotMatch(source, /export default tool\(/);
    assert.match(source, /knowledge vault/);
    assert.match(source, /NOT skills/);
    assert.doesNotMatch(source, /listSkills/);
    assert.doesNotMatch(source, /\.claude/);
    assert.doesNotMatch(source, /\.agents/);
    assert.match(source, /\/tmp\/knowledge/);
    assert.match(source, /ONMYAGENT_KNOWLEDGE_WORKSPACE_ID/);
    assert.match(source, /ONMYAGENT_KNOWLEDGE_EXPERT_ID/);
    assert.match(source, /session-defaults\.json/);
    assert.match(source, /from "\.\/knowledge-vault-walk\.mjs"/);
    assert.doesNotMatch(source, /const walk = async/);
    const read = renderKnowledgeReadPluginSource("/tmp/knowledge");
    assert.match(read, /export default async \(\) => \(\{/);
    assert.match(read, /knowledge_read: tool\(/);
    const property = renderKnowledgePropertyPluginSource("/tmp/knowledge");
    assert.match(property, /knowledge_property_set: tool\(/);
  });

  test("query-only search hits planted project and expert notes via session defaults", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-plugin-search-"));
    try {
      await writeKnowledgeFile({
        homeDir: home,
        scope: "user",
        relPath: "getting-started.md",
        content: "# Getting started\n\nPersonal vault only.\n",
      });
      await writeKnowledgeFile({
        homeDir: home,
        scope: "project",
        workspaceId: "ws_local",
        relPath: "roadmap.md",
        content: "# Roadmap\n\nShip knowledge-scope-token for the current project.\n",
      });
      await writeKnowledgeFile({
        homeDir: home,
        scope: "expert",
        expertId: "ops-specialist",
        relPath: "playbook.md",
        content: "# Playbook\n\nExpert-only knowledge-scope-token briefing.\n",
      });
      await writeKnowledgeSessionDefaults({
        homeDir: home,
        workspaceId: "ws_local",
        expertId: "ops-specialist",
      });
      const result = await executeKnowledgeSearch({
        knowledgeRoot: resolveKnowledgeRoot(home),
        query: "knowledge-scope-token",
        env: {},
      });
      assert.equal(result.ok, true);
      assert.ok(result.hits.some((hit) => hit.relPath === "roadmap.md" && hit.scope === "project"));
      assert.ok(result.hits.some((hit) => hit.relPath === "playbook.md" && hit.scope === "expert"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("installs under OpenCode config plugins, not the skills root", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-kv-plugin-"));
    try {
      const configDir = path.join(home, "xdg", "config", "opencode");
      const result = await installKnowledgeSearchPlugin({
        configDir,
        homeDir: home,
      });
      assert.equal(result.ok, true);
      assert.equal(
        result.pluginPath,
        path.join(configDir, "plugins", "knowledge-search.mjs"),
      );
      assert.equal(result.knowledgeRoot, resolveKnowledgeRoot(home));
      assert.ok(!result.pluginPath.includes(`${path.sep}skills${path.sep}`));
      assert.equal(result.pluginPaths?.length, 5);
      assert.ok(result.skillPath?.endsWith(`${path.sep}knowledge-vault${path.sep}SKILL.md`));
      const body = await readFile(result.pluginPath, "utf8");
      assert.match(body, /export default async \(\) => \(\{/);
      assert.match(body, /knowledge_search: tool\(/);
      const readBody = await readFile(path.join(configDir, "plugins", "knowledge-read.mjs"), "utf8");
      assert.match(readBody, /knowledge_read: tool\(/);
      assert.match(readBody, /knowledgeReadNote/);
      const skill = await readFile(result.skillPath, "utf8");
      assert.match(skill, /knowledge_read/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
