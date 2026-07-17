import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type {
  ArtifactPluginManifest,
  ArtifactPluginRuntimeConfig,
} from "@onmyagent/types/artifact-plugin";

import {
  getArtifactPlugin,
  scanArtifactPlugins,
} from "../src/services/artifact-plugin-registry.js";

const documentsManifest: ArtifactPluginManifest = {
  name: "documents",
  version: "1.0.0",
  description: "Create and review document files.",
  author: { name: "OnMyAgent" },
  skills: "./skills/",
  interface: {
    displayName: "Documents",
    shortDescription: "Work with document files.",
    longDescription: "Create, read, and revise local document files.",
    developerName: "OnMyAgent",
    category: "Productivity",
    capabilities: ["Interactive", "Write"],
    composerIcon: "./assets/icon.svg",
    logo: "./assets/logo.svg",
    defaultPrompt: ["Draft a document"],
    screenshots: [],
  },
  keywords: [],
};

const documentsRuntime: ArtifactPluginRuntimeConfig = {
  skills: [{ id: "documents", defaultEnabled: true }],
  routing: {
    extensions: [".docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  runtime: {
    entry: "runtime/artifact_runtime.py",
    requiredTools: ["python", "libreoffice"],
  },
};

type FixturePackage = {
  manifest: unknown;
  runtime: unknown;
  files?: string[];
  directories?: string[];
};

async function createFixtureRoot(packages: Record<string, FixturePackage>) {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-artifact-plugins-"));
  for (const [directory, pluginPackage] of Object.entries(packages)) {
    const pluginRoot = join(root, directory);
    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
    await mkdir(join(pluginRoot, ".onmyagent"), { recursive: true });
    await writeFile(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify(pluginPackage.manifest),
    );
    await writeFile(
      join(pluginRoot, ".onmyagent", "artifact.json"),
      JSON.stringify(pluginPackage.runtime),
    );
    for (const relativePath of pluginPackage.files ?? []) {
      const target = join(pluginRoot, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, "fixture");
    }
    for (const relativePath of pluginPackage.directories ?? []) {
      await mkdir(join(pluginRoot, relativePath), { recursive: true });
    }
  }
  return root;
}

test("loads valid manifests and isolates invalid packages", async () => {
  const root = await createFixtureRoot({
    documents: {
      manifest: documentsManifest,
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
    },
    invalid: {
      manifest: { ...documentsManifest, name: "Bad ID" },
      runtime: documentsRuntime,
    },
  });

  try {
    const catalog = await scanArtifactPlugins(root);
    assert.deepEqual(
      catalog.items.map((item) => item.manifest.name),
      ["documents"],
    );
    assert.equal(catalog.items[0]?.root, join(root, "documents"));
    assert.equal(catalog.diagnostics.length, 1);
    assert.equal(catalog.diagnostics[0]?.pluginDirectory, "invalid");
    assert.equal(getArtifactPlugin(catalog, "documents"), catalog.items[0]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects references that escape the plugin root", async () => {
  const root = await createFixtureRoot({
    escape: {
      manifest: { ...documentsManifest, name: "escape", skills: "../skills/" },
      runtime: documentsRuntime,
    },
  });

  try {
    const catalog = await scanArtifactPlugins(root);
    assert.equal(catalog.items.length, 0);
    assert.match(catalog.diagnostics[0]?.message ?? "", /plugin root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects missing skill, app, asset, and runtime references", async () => {
  const root = await createFixtureRoot({
    "missing-skill": {
      manifest: { ...documentsManifest, name: "missing-skill" },
      runtime: documentsRuntime,
      files: [
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
    },
    "missing-app": {
      manifest: {
        ...documentsManifest,
        name: "missing-app",
        apps: "./.app.json",
      },
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
    },
    "missing-asset": {
      manifest: { ...documentsManifest, name: "missing-asset" },
      runtime: documentsRuntime,
      files: ["skills/documents/SKILL.md", "runtime/artifact_runtime.py"],
    },
    "missing-runtime": {
      manifest: { ...documentsManifest, name: "missing-runtime" },
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
      ],
    },
  });

  try {
    const catalog = await scanArtifactPlugins(root);
    assert.equal(catalog.items.length, 0);
    assert.deepEqual(
      catalog.diagnostics.map((diagnostic) => diagnostic.pluginDirectory),
      ["missing-app", "missing-asset", "missing-runtime", "missing-skill"],
    );
    for (const diagnostic of catalog.diagnostics) {
      assert.match(diagnostic.message, /does not exist/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loads the three bundled artifact plugin packages", async () => {
  const root = join(
    import.meta.dirname,
    "../../desktop/resources/bundled-plugins",
  );
  const catalog = await scanArtifactPlugins(root);

  assert.deepEqual(catalog.diagnostics, []);
  assert.deepEqual(
    catalog.items.map((item) => item.manifest.name),
    ["documents", "pdf", "spreadsheets"],
  );
  assert.deepEqual(
    catalog.items.map((item) => item.runtime.skills.map((skill) => skill.id)),
    [["documents"], ["pdf"], ["spreadsheets", "excel-live-control"]],
  );
  assert.equal(catalog.items[2]?.manifest.apps, "./.app.json");
});

test("rejects manifest and companion files that resolve outside the plugin root", async () => {
  const root = await createFixtureRoot({
    documents: {
      manifest: documentsManifest,
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
    },
    companion: {
      manifest: { ...documentsManifest, name: "companion" },
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
    },
  });

  try {
    const outsideManifest = join(root, "outside-manifest.json");
    const outsideCompanion = join(root, "outside-companion.json");
    await writeFile(outsideManifest, JSON.stringify(documentsManifest));
    await writeFile(outsideCompanion, JSON.stringify(documentsRuntime));
    const manifestPath = join(root, "documents", ".codex-plugin", "plugin.json");
    const companionPath = join(root, "companion", ".onmyagent", "artifact.json");
    await unlink(manifestPath);
    await unlink(companionPath);
    await symlink(outsideManifest, manifestPath);
    await symlink(outsideCompanion, companionPath);

    const catalog = await scanArtifactPlugins(root);
    assert.equal(catalog.items.length, 0);
    assert.deepEqual(
      catalog.diagnostics.map((diagnostic) => diagnostic.pluginDirectory),
      ["companion", "documents"],
    );
    for (const diagnostic of catalog.diagnostics) {
      assert.match(diagnostic.message, /plugin root/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unknown manifest and runtime companion fields", async () => {
  const root = await createFixtureRoot({
    "manifest-routing": {
      manifest: { ...documentsManifest, name: "manifest-routing", routing: {} },
      runtime: documentsRuntime,
    },
    "runtime-extra": {
      manifest: { ...documentsManifest, name: "runtime-extra" },
      runtime: { ...documentsRuntime, connector: "unexpected" },
    },
  });

  try {
    const catalog = await scanArtifactPlugins(root);
    assert.equal(catalog.items.length, 0);
    assert.equal(catalog.diagnostics.length, 2);
    for (const diagnostic of catalog.diagnostics) {
      assert.match(diagnostic.message, /unrecognized key/i);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed app manifests and proprietary app fields", async () => {
  const root = await createFixtureRoot({
    "malformed-app": {
      manifest: {
        ...documentsManifest,
        name: "malformed-app",
        apps: "./.app.json",
      },
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
        ".app.json",
      ],
    },
    "app-connector": {
      manifest: {
        ...documentsManifest,
        name: "app-connector",
        apps: "./.app.json",
      },
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
    },
  });

  try {
    await writeFile(join(root, "malformed-app", ".app.json"), "{broken");
    await writeFile(
      join(root, "app-connector", ".app.json"),
      JSON.stringify({
        apps: {
          documents: {
            id: "documents",
            category: "Productivity",
            connector: "proprietary",
          },
        },
      }),
    );
    const catalog = await scanArtifactPlugins(root);
    assert.equal(catalog.items.length, 0);
    assert.equal(catalog.diagnostics.length, 2);
    assert.match(
      catalog.diagnostics.find(
        (diagnostic) => diagnostic.pluginDirectory === "malformed-app",
      )?.message ?? "",
      /JSON/i,
    );
    assert.match(
      catalog.diagnostics.find(
        (diagnostic) => diagnostic.pluginDirectory === "app-connector",
      )?.message ?? "",
      /unrecognized key/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires every declared app id to match a runtime skill", async () => {
  const root = await createFixtureRoot({
    documents: {
      manifest: { ...documentsManifest, apps: "./.app.json" },
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
    },
  });

  try {
    await writeFile(
      join(root, "documents", ".app.json"),
      JSON.stringify({
        apps: {
          "excel-live-control": {
            id: "excel-live-control",
            category: "Productivity",
          },
        },
      }),
    );
    const catalog = await scanArtifactPlugins(root);
    assert.equal(catalog.items.length, 0);
    assert.match(catalog.diagnostics[0]?.message ?? "", /runtime skill/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires file references to be files and the skills root to be a directory", async () => {
  const root = await createFixtureRoot({
    "asset-directory": {
      manifest: { ...documentsManifest, name: "asset-directory" },
      runtime: documentsRuntime,
      files: ["skills/documents/SKILL.md", "runtime/artifact_runtime.py"],
      directories: ["assets/icon.svg", "assets/logo.svg"],
    },
    "app-directory": {
      manifest: {
        ...documentsManifest,
        name: "app-directory",
        apps: "./.app.json",
      },
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
      directories: [".app.json"],
    },
    "runtime-directory": {
      manifest: { ...documentsManifest, name: "runtime-directory" },
      runtime: documentsRuntime,
      files: [
        "skills/documents/SKILL.md",
        "assets/icon.svg",
        "assets/logo.svg",
      ],
      directories: ["runtime/artifact_runtime.py"],
    },
    "skills-file": {
      manifest: {
        ...documentsManifest,
        name: "skills-file",
        skills: "./skills-file",
      },
      runtime: documentsRuntime,
      files: [
        "skills-file",
        "assets/icon.svg",
        "assets/logo.svg",
        "runtime/artifact_runtime.py",
      ],
    },
  });

  try {
    const catalog = await scanArtifactPlugins(root);
    assert.equal(catalog.items.length, 0);
    assert.equal(catalog.diagnostics.length, 4);
    assert.match(
      catalog.diagnostics.find(
        (diagnostic) => diagnostic.pluginDirectory === "skills-file",
      )?.message ?? "",
      /directory/,
    );
    for (const pluginDirectory of [
      "app-directory",
      "asset-directory",
      "runtime-directory",
    ]) {
      assert.match(
        catalog.diagnostics.find(
          (diagnostic) => diagnostic.pluginDirectory === pluginDirectory,
        )?.message ?? "",
        /file/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
