import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  materializeEnabledArtifactSkills,
  scanBundledArtifactPlugins,
} from "../electron/artifact-plugin-runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bundledPluginsRoot = path.resolve(
  scriptDir,
  "..",
  "resources",
  "bundled-plugins",
);
const expectedSkills = new Map([
  ["browser", ["browser-automation"]],
  ["documents", ["documents"]],
  ["pdf", ["pdf"]],
  ["spreadsheets", ["spreadsheets", "excel-live-control"]],
]);

function frontmatterValue(markdown, key) {
  const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;
  const line = block[1]
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${key}:`));
  return line
    ? line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "")
    : null;
}

test("plugin packages are the source of truth for Artifact skill identities", async () => {
  const catalog = await scanBundledArtifactPlugins(bundledPluginsRoot);
  assert.deepEqual(catalog.diagnostics, []);
  assert.deepEqual(
    catalog.items.map((plugin) => plugin.pluginId),
    [...expectedSkills.keys()],
  );
  for (const plugin of catalog.items) {
    assert.deepEqual(
      plugin.skills.map((skill) => skill.id),
      expectedSkills.get(plugin.pluginId),
    );
    for (const skill of plugin.skills) {
      assert.equal(
        (await realpath(skill.sourcePath)).startsWith(
          `${await realpath(path.join(bundledPluginsRoot, plugin.pluginId))}${path.sep}`,
        ),
        true,
      );
      const markdown = await readFile(path.join(skill.sourcePath, "SKILL.md"), "utf8");
      assert.equal(frontmatterValue(markdown, "name"), skill.id);
      assert.ok(frontmatterValue(markdown, "description"));
    }
  }
});

test("managed links resolve to package-local Artifact skills", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-skills-"));
  try {
    const enabledSkillIds = new Set([...expectedSkills.values()].flat());
    const result = await materializeEnabledArtifactSkills({
      pluginRoot: bundledPluginsRoot,
      managedSkillsRoot: path.join(tempRoot, "skills"),
      enabledSkillIds,
    });
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(
      result.items.map((item) => item.skillId).sort(),
      [...enabledSkillIds].sort(),
    );
    for (const item of result.items) {
      assert.equal(await realpath(item.destinationPath), await realpath(item.sourcePath));
      assert.equal(existsSync(path.join(item.destinationPath, "SKILL.md")), true);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("desktop packaging copies bundled plugin packages into application resources", async () => {
  const builderConfig = await readFile(
    path.resolve(scriptDir, "..", "electron-builder.yml"),
    "utf8",
  );
  assert.match(builderConfig, /from:\s*resources\/bundled-plugins/);
  assert.match(builderConfig, /to:\s*bundled-plugins/);
  assert.match(builderConfig, /from:\s*resources\/bundled-skills/);
  assert.match(builderConfig, /to:\s*bundled-skills/);
});

test("package runtimes truthfully remain Task 8 placeholders", async () => {
  const catalog = await scanBundledArtifactPlugins(bundledPluginsRoot);
  for (const plugin of catalog.items) {
    // Browser is host-integrated (Electron in-app browser); it has no Python runtime.
    if (plugin.pluginId === "browser") continue;
    const runtime = JSON.parse(
      await readFile(path.join(plugin.root, ".onmyagent", "artifact.json"), "utf8"),
    );
    assert.equal(typeof runtime.runtime?.entry, "string");
    assert.equal(existsSync(path.join(plugin.root, runtime.runtime.entry)), true);
  }
});
