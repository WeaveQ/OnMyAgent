import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARTIFACT_PLUGIN_SKILL_IDS,
  materializeEnabledArtifactSkills,
  materializeLegacySkillLinks,
  readArtifactPluginEnablementSnapshot,
  scanBundledArtifactPlugins,
} from "./artifact-plugin-runtime.mjs";

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writePlugin(root, pluginId, skills) {
  const pluginRoot = path.join(root, pluginId);
  await writeJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"), {
    name: pluginId,
    version: "1.0.0",
    description: `${pluginId} plugin`,
    author: { name: "OnMyAgent" },
    keywords: [],
    skills: "./skills/",
    interface: {
      displayName: pluginId,
      shortDescription: pluginId,
      longDescription: pluginId,
      developerName: "OnMyAgent",
      category: "Productivity",
      capabilities: ["Interactive"],
      defaultPrompt: [],
      screenshots: [],
    },
  });
  await writeJson(path.join(pluginRoot, ".onmyagent", "artifact.json"), {
    skills,
    routing: { extensions: [], mimeTypes: [] },
  });
  for (const skill of skills) {
    const skillRoot = path.join(pluginRoot, "skills", skill.id);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      path.join(skillRoot, "SKILL.md"),
      `---\nname: ${skill.id}\ndescription: test\n---\n`,
      "utf8",
    );
  }
  return pluginRoot;
}

test("scans valid plugins while isolating invalid packages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-scan-"));
  try {
    await writePlugin(root, "documents", [
      { id: "documents", defaultEnabled: true },
    ]);
    await mkdir(path.join(root, "broken", ".codex-plugin"), { recursive: true });
    await writeFile(
      path.join(root, "broken", ".codex-plugin", "plugin.json"),
      "not json",
      "utf8",
    );

    const result = await scanBundledArtifactPlugins(root);
    assert.deepEqual(result.items.map((item) => item.pluginId), ["documents"]);
    assert.deepEqual(
      result.diagnostics.map((item) => item.pluginDirectory),
      ["broken"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces strict canonical and runtime descriptor shapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-shapes-"));
  try {
    const canonical = await writePlugin(root, "canonical", [
      { id: "canonical", defaultEnabled: true },
    ]);
    const canonicalManifestPath = path.join(
      canonical,
      ".codex-plugin",
      "plugin.json",
    );
    const canonicalManifest = JSON.parse(
      await readFile(canonicalManifestPath, "utf8"),
    );
    delete canonicalManifest.interface.screenshots;
    await writeJson(canonicalManifestPath, canonicalManifest);

    const internal = await writePlugin(root, "internal", [
      { id: "internal", defaultEnabled: true },
    ]);
    const internalManifestPath = path.join(
      internal,
      ".codex-plugin",
      "plugin.json",
    );
    const internalManifest = JSON.parse(
      await readFile(internalManifestPath, "utf8"),
    );
    internalManifest.routing = { extensions: [] };
    await writeJson(internalManifestPath, internalManifest);

    const runtime = await writePlugin(root, "runtime-extra", [
      { id: "runtime-extra", defaultEnabled: true },
    ]);
    const runtimePath = path.join(runtime, ".onmyagent", "artifact.json");
    const runtimeDescriptor = JSON.parse(await readFile(runtimePath, "utf8"));
    runtimeDescriptor.connector = "private";
    await writeJson(runtimePath, runtimeDescriptor);

    const result = await scanBundledArtifactPlugins(root);
    assert.deepEqual(result.items.map((item) => item.pluginId), ["canonical"]);
    assert.deepEqual(
      result.diagnostics.map((item) => item.pluginDirectory).sort(),
      ["internal", "runtime-extra"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("matches shared descriptor validation for URLs, bounds, routing, and apps", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-parity-"));
  const invalid = [];
  try {
    async function mutate(pluginId, change) {
      invalid.push(pluginId);
      const pluginRoot = await writePlugin(root, pluginId, [
        { id: pluginId, defaultEnabled: true },
      ]);
      const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
      const runtimePath = path.join(pluginRoot, ".onmyagent", "artifact.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
      await change({ pluginRoot, manifest, runtime });
      await writeJson(manifestPath, manifest);
      await writeJson(runtimePath, runtime);
    }

    await mutate("bad-email", ({ manifest }) => { manifest.author.email = "invalid"; });
    await mutate("bad-author-url", ({ manifest }) => { manifest.author.url = "invalid"; });
    await mutate("bad-homepage", ({ manifest }) => { manifest.homepage = "invalid"; });
    await mutate("bad-repository", ({ manifest }) => { manifest.repository = "invalid"; });
    await mutate("bad-website", ({ manifest }) => { manifest.interface.websiteURL = "invalid"; });
    await mutate("bad-privacy", ({ manifest }) => { manifest.interface.privacyPolicyURL = "invalid"; });
    await mutate("bad-terms", ({ manifest }) => { manifest.interface.termsOfServiceURL = "invalid"; });
    await mutate("bad-license", ({ manifest }) => { manifest.license = ""; });
    await mutate("bad-keyword", ({ manifest }) => { manifest.keywords = [""]; });
    await mutate("bad-color", ({ manifest }) => { manifest.interface.brandColor = "blue"; });
    await mutate("too-many-shots", ({ manifest }) => {
      manifest.interface.screenshots = ["a.svg", "b.svg", "c.svg", "d.svg"];
    });
    await mutate("bad-shot-path", ({ manifest }) => {
      manifest.interface.screenshots = ["../outside.svg"];
    });
    await mutate("bad-extension", ({ runtime }) => { runtime.routing.extensions = ["pdf"]; });
    await mutate("bad-mime", ({ runtime }) => { runtime.routing.mimeTypes = [""]; });
    await mutate("bad-app-shape", async ({ pluginRoot, manifest }) => {
      manifest.apps = "./.app.json";
      await writeJson(path.join(pluginRoot, ".app.json"), {
        apps: { "bad-app-shape": { id: "bad-app-shape", category: "office", extra: true } },
      });
    });
    await mutate("bad-app-id", async ({ pluginRoot, manifest }) => {
      manifest.apps = "./.app.json";
      await writeJson(path.join(pluginRoot, ".app.json"), {
        apps: { other: { id: "other", category: "office" } },
      });
    });

    const valid = await writePlugin(root, "valid-app", [
      { id: "valid-app", defaultEnabled: true },
    ]);
    const validManifestPath = path.join(valid, ".codex-plugin", "plugin.json");
    const validManifest = JSON.parse(await readFile(validManifestPath, "utf8"));
    delete validManifest.keywords;
    validManifest.apps = "./.app.json";
    await writeJson(validManifestPath, validManifest);
    await writeJson(path.join(valid, ".app.json"), {
      apps: { "valid-app": { id: "valid-app", category: "office" } },
    });

    const result = await scanBundledArtifactPlugins(root);
    assert.deepEqual(result.items.map((item) => item.pluginId), ["valid-app"]);
    assert.deepEqual(
      result.diagnostics.map((item) => item.pluginDirectory).sort(),
      invalid.sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal, escaping symlinks, and non-file skill references independently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-bounds-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-outside-"));
  try {
    const traversal = await writePlugin(root, "traversal", [
      { id: "traversal", defaultEnabled: true },
    ]);
    const traversalManifest = JSON.parse(
      await readFile(path.join(traversal, ".codex-plugin", "plugin.json"), "utf8"),
    );
    traversalManifest.skills = "../outside";
    await writeJson(
      path.join(traversal, ".codex-plugin", "plugin.json"),
      traversalManifest,
    );

    const escaping = await writePlugin(root, "escaping", [
      { id: "escaping", defaultEnabled: true },
    ]);
    await rm(path.join(escaping, "skills", "escaping"), { recursive: true });
    await mkdir(path.join(outside, "escaping"));
    await writeFile(path.join(outside, "escaping", "SKILL.md"), "outside", "utf8");
    await symlink(
      path.join(outside, "escaping"),
      path.join(escaping, "skills", "escaping"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const nonFile = await writePlugin(root, "non-file", [
      { id: "non-file", defaultEnabled: true },
    ]);
    await rm(path.join(nonFile, "skills", "non-file", "SKILL.md"));
    await mkdir(path.join(nonFile, "skills", "non-file", "SKILL.md"));

    const result = await scanBundledArtifactPlugins(root);
    assert.deepEqual(result.items, []);
    assert.deepEqual(
      result.diagnostics.map((item) => item.pluginDirectory).sort(),
      ["escaping", "non-file", "traversal"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("reads default-compatible effective enablement and fails closed on malformed state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-state-"));
  try {
    const statePath = path.join(root, "artifact-plugins.json");
    const catalog = {
      items: [
        {
          pluginId: "spreadsheets",
          skills: [
            { id: "spreadsheets", defaultEnabled: true },
            { id: "excel-live-control", defaultEnabled: false },
          ],
        },
      ],
      diagnostics: [],
    };

    const defaults = await readArtifactPluginEnablementSnapshot({
      enablementPath: statePath,
      catalog,
    });
    assert.deepEqual([...defaults.enabledSkillIds], ["spreadsheets"]);
    assert.deepEqual(defaults.diagnostics, []);

    await writeFile(statePath, "malformed", "utf8");
    const malformed = await readArtifactPluginEnablementSnapshot({
      enablementPath: statePath,
      catalog,
    });
    assert.deepEqual([...malformed.enabledSkillIds], []);
    assert.equal(malformed.diagnostics.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("materializes only enabled skills and removes stale owned links", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-links-"));
  try {
    const pluginRoot = path.join(root, "plugins");
    const managedSkillsRoot = path.join(root, "managed-skills");
    await writePlugin(pluginRoot, "documents", [
      { id: "documents", defaultEnabled: true },
    ]);
    await writePlugin(pluginRoot, "pdf", [{ id: "pdf", defaultEnabled: true }]);
    await writePlugin(pluginRoot, "spreadsheets", [
      { id: "spreadsheets", defaultEnabled: true },
    ]);

    const initial = await materializeEnabledArtifactSkills({
      pluginRoot,
      managedSkillsRoot,
      enabledSkillIds: new Set(["documents", "pdf"]),
    });
    assert.deepEqual(
      initial.items.map((item) => item.skillId).sort(),
      ["documents", "pdf"],
    );
    assert.equal(
      await lstat(path.join(managedSkillsRoot, "documents")).then((entry) =>
        entry.isSymbolicLink(),
      ),
      true,
    );
    assert.equal(existsSync(path.join(managedSkillsRoot, "spreadsheets")), false);

    const next = await materializeEnabledArtifactSkills({
      pluginRoot,
      managedSkillsRoot,
      enabledSkillIds: new Set(["pdf"]),
    });
    assert.deepEqual(next.items.map((item) => item.skillId), ["pdf"]);
    assert.equal(existsSync(path.join(managedSkillsRoot, "documents")), false);
    assert.equal(
      await realpath(path.join(managedSkillsRoot, "pdf")),
      await realpath(path.join(pluginRoot, "pdf", "skills", "pdf")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves conflicting directories and unrelated symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-conflict-"));
  try {
    const pluginRoot = path.join(root, "plugins");
    const managedSkillsRoot = path.join(root, "managed-skills");
    const unrelated = path.join(root, "unrelated");
    await writePlugin(pluginRoot, "documents", [
      { id: "documents", defaultEnabled: true },
    ]);
    await writePlugin(pluginRoot, "pdf", [{ id: "pdf", defaultEnabled: true }]);
    await mkdir(path.join(managedSkillsRoot, "documents"), { recursive: true });
    await writeFile(path.join(managedSkillsRoot, "documents", "keep.txt"), "keep", "utf8");
    await mkdir(unrelated);
    await symlink(
      unrelated,
      path.join(managedSkillsRoot, "unrelated-link"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await materializeEnabledArtifactSkills({
      pluginRoot,
      managedSkillsRoot,
      enabledSkillIds: new Set(["documents"]),
    });
    assert.deepEqual(result.items, []);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(
      await readFile(path.join(managedSkillsRoot, "documents", "keep.txt"), "utf8"),
      "keep",
    );
    assert.equal(await realpath(path.join(managedSkillsRoot, "unrelated-link")), await realpath(unrelated));
    assert.equal(existsSync(path.join(managedSkillsRoot, "pdf")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reserves Artifact identities when packages are missing or malformed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-reserved-"));
  try {
    assert.deepEqual(ARTIFACT_PLUGIN_SKILL_IDS, [
      "browser-automation",
      "documents",
      "pdf",
      "spreadsheets",
      "excel-live-control",
    ]);
    const pluginRoot = path.join(root, "plugins");
    const managedSkillsRoot = path.join(root, "managed-skills");
    const legacyRoot = path.join(root, "legacy");
    const documentsPlugin = await writePlugin(pluginRoot, "documents", [
      { id: "documents", defaultEnabled: true },
    ]);
    await materializeEnabledArtifactSkills({
      pluginRoot,
      managedSkillsRoot,
      enabledSkillIds: new Set(["documents"]),
    });
    assert.equal(existsSync(path.join(managedSkillsRoot, "documents")), true);

    const manifestPath = path.join(documentsPlugin, ".codex-plugin", "plugin.json");
    const malformed = JSON.parse(await readFile(manifestPath, "utf8"));
    malformed.homepage = "invalid";
    await writeJson(manifestPath, malformed);
    await materializeEnabledArtifactSkills({
      pluginRoot,
      managedSkillsRoot,
      enabledSkillIds: new Set(["documents"]),
    });
    assert.equal(existsSync(path.join(managedSkillsRoot, "documents")), false);

    for (const skillId of ["documents", "pdf", "ordinary"]) {
      const skillRoot = path.join(legacyRoot, skillId);
      await mkdir(skillRoot, { recursive: true });
      await writeFile(path.join(skillRoot, "SKILL.md"), skillId, "utf8");
    }
    await materializeLegacySkillLinks({
      skillDirs: ["documents", "pdf", "ordinary"].map((skillId) =>
        path.join(legacyRoot, skillId)),
      managedSkillsRoot,
    });
    assert.equal(existsSync(path.join(managedSkillsRoot, "documents")), false);
    assert.equal(existsSync(path.join(managedSkillsRoot, "pdf")), false);
    assert.equal(
      await realpath(path.join(managedSkillsRoot, "ordinary")),
      await realpath(path.join(legacyRoot, "ordinary")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
