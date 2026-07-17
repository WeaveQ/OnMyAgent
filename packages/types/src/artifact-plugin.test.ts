// @ts-expect-error -- this package intentionally omits Node.js runtime types.
import test from "node:test";
// @ts-expect-error -- this package intentionally omits Node.js runtime types.
import assert from "node:assert/strict";
import {
  artifactPluginConnectionStateSchema,
  artifactPluginContextSchema,
  artifactPluginEnablementSchema,
  artifactPluginManifestSchema,
  artifactPluginRuntimeConfigSchema,
} from "./artifact-plugin.js";

const documentsManifest = (skills = "./skills/") => ({
  name: "documents",
  version: "1.0.0",
  description: "Create and edit document artifacts",
  author: {
    name: "OpenAI",
    email: "plugins@example.com",
    url: "https://openai.com",
  },
  homepage: "https://openai.com",
  repository: "https://github.com/openai/codex",
  license: "Apache-2.0",
  keywords: ["documents", "docx"],
  skills,
  apps: "./.app.json",
  interface: {
    displayName: "Documents",
    shortDescription: "Create and edit document artifacts",
    longDescription: "Create, edit, render, and verify DOCX files.",
    developerName: "OpenAI",
    category: "Productivity",
    capabilities: ["Create documents", "Edit documents"],
    websiteURL: "https://openai.com",
    privacyPolicyURL: "https://openai.com/policies/privacy-policy",
    termsOfServiceURL: "https://openai.com/policies/terms-of-use",
    composerIcon: "./assets/composer.svg",
    logo: "./assets/logo.svg",
    logoDark: "./assets/logo-dark.svg",
    defaultPrompt: ["Create a project brief"],
    brandColor: "#2563EB",
    screenshots: ["./assets/screenshot.png"],
  },
});

const runtimeConfig = () => ({
  skills: [{ id: "documents", defaultEnabled: true }],
  routing: {
    extensions: [".docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  runtime: {
    entry: "./runtime/artifact_runtime.py",
    requiredTools: ["python", "libreoffice"],
  },
});

test("accepts a canonical Documents manifest", () => {
  const value = artifactPluginManifestSchema.parse(documentsManifest());

  assert.equal(value.name, "documents");
  assert.equal(value.skills, "./skills/");
  assert.deepEqual(value.interface.defaultPrompt, ["Create a project brief"]);
});

test("rejects the superseded internal-only manifest shape", () => {
  assert.throws(() =>
    artifactPluginManifestSchema.parse({
      id: "documents",
      version: "1.0.0",
      interface: {
        displayName: "Documents",
        shortDescription: "x",
        longDescription: "x",
        defaultPrompts: [],
      },
      capabilities: ["read"],
      skills: [
        { id: "documents", path: "skills/documents", defaultEnabled: true },
      ],
    }),
  );
});

test("accepts separate OnMyAgent runtime configuration", () => {
  const value = artifactPluginRuntimeConfigSchema.parse(runtimeConfig());

  assert.equal(value.skills[0]?.id, "documents");
  assert.equal(value.runtime?.entry, "./runtime/artifact_runtime.py");
});

test("rejects unknown canonical manifest fields", () => {
  const manifest = documentsManifest();

  assert.throws(() =>
    artifactPluginManifestSchema.parse({
      ...manifest,
      routing: { extensions: [".docx"], mimeTypes: [] },
    }),
  );
  assert.throws(() =>
    artifactPluginManifestSchema.parse({
      ...manifest,
      interface: { ...manifest.interface, internalCapability: "connector" },
    }),
  );
  assert.throws(() =>
    artifactPluginManifestSchema.parse({
      ...manifest,
      author: { ...manifest.author, internalId: "openai" },
    }),
  );
});

test("rejects unknown runtime companion fields at every boundary", () => {
  const config = runtimeConfig();

  assert.throws(() =>
    artifactPluginRuntimeConfigSchema.parse({
      ...config,
      proprietaryConnector: "documents",
    }),
  );
  assert.throws(() =>
    artifactPluginRuntimeConfigSchema.parse({
      ...config,
      skills: [{ ...config.skills[0], path: "./skills/" }],
    }),
  );
  assert.throws(() =>
    artifactPluginRuntimeConfigSchema.parse({
      ...config,
      routing: { ...config.routing, proprietaryRoute: true },
    }),
  );
  assert.throws(() =>
    artifactPluginRuntimeConfigSchema.parse({
      ...config,
      runtime: { ...config.runtime, connectorId: "documents" },
    }),
  );
});

test("rejects unknown context, connection, and enablement fields", () => {
  assert.throws(() =>
    artifactPluginContextSchema.parse({
      pluginId: "documents",
      skillId: "documents",
      activationSource: "composer",
      internalContext: true,
    }),
  );
  assert.throws(() =>
    artifactPluginConnectionStateSchema.parse({
      status: "connected",
      connectorId: "documents",
    }),
  );
  assert.throws(() =>
    artifactPluginContextSchema.parse({
      pluginId: "documents",
      skillId: "documents",
      activationSource: "connected-app",
      connection: { status: "connected", connectorId: "documents" },
    }),
  );
  assert.throws(() =>
    artifactPluginEnablementSchema.parse({
      plugins: {},
      internalState: true,
    }),
  );
  assert.throws(() =>
    artifactPluginEnablementSchema.parse({
      plugins: {
        documents: { enabled: true, skills: {}, internalState: true },
      },
    }),
  );
});

test("rejects invalid activation sources", () => {
  assert.throws(() =>
    artifactPluginContextSchema.parse({
      pluginId: "documents",
      skillId: "documents",
      activationSource: "magic",
    }),
  );
});

test("rejects absolute and traversal plugin paths", () => {
  const invalidPaths = [
    "C:\\plugin\\SKILL.md",
    "\\\\server\\share\\SKILL.md",
    "\\skills\\SKILL.md",
    "/skills/SKILL.md",
    "../SKILL.md",
    "skills\\..\\SKILL.md",
  ];

  for (const path of invalidPaths) {
    assert.throws(
      () => artifactPluginManifestSchema.parse(documentsManifest(path)),
      path,
    );
  }
});
