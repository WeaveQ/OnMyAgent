import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

import {
  artifactPluginManifestSchema,
  artifactPluginRuntimeConfigSchema,
  type ArtifactPluginManifest,
  type ArtifactPluginRuntimeConfig,
} from "@onmyagent/types/artifact-plugin";

export type ArtifactPluginPackage = {
  manifest: ArtifactPluginManifest;
  runtime: ArtifactPluginRuntimeConfig;
  root: string;
};

export type ArtifactPluginCatalog = {
  items: ArtifactPluginPackage[];
  diagnostics: Array<{ pluginDirectory: string; message: string }>;
};

const pluginIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const artifactPluginAppManifestSchema = z
  .object({
    apps: z.record(
      pluginIdSchema,
      z
        .object({
          id: pluginIdSchema,
          category: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

type ReferenceKind = "file" | "directory";

function isWithin(root: string, target: string) {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

async function verifyReference(
  pluginRoot: string,
  pluginRealRoot: string,
  reference: string,
  expectedKind: ReferenceKind,
) {
  const target = resolve(pluginRoot, reference);
  if (!isWithin(pluginRoot, target)) {
    throw new Error(`reference must stay inside the plugin root: ${reference}`);
  }

  let realTarget: string;
  try {
    realTarget = await realpath(target);
  } catch {
    throw new Error(`referenced path does not exist: ${reference}`);
  }
  if (!isWithin(pluginRealRoot, realTarget)) {
    throw new Error(`reference must stay inside the plugin root: ${reference}`);
  }
  const referenceStat = await stat(realTarget);
  const validKind =
    expectedKind === "file" ? referenceStat.isFile() : referenceStat.isDirectory();
  if (!validKind) {
    throw new Error(`referenced path must be a ${expectedKind}: ${reference}`);
  }
  return target;
}

async function readJsonReference(
  pluginRoot: string,
  pluginRealRoot: string,
  reference: string,
): Promise<unknown> {
  const path = await verifyReference(
    pluginRoot,
    pluginRealRoot,
    reference,
    "file",
  );
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`referenced file must contain valid JSON: ${reference}`);
  }
}

async function loadArtifactPlugin(
  root: string,
  pluginDirectory: string,
): Promise<ArtifactPluginPackage> {
  const pluginRoot = join(root, pluginDirectory);
  const pluginRealRoot = await realpath(pluginRoot);
  const manifestResult = artifactPluginManifestSchema.safeParse(
    await readJsonReference(
      pluginRoot,
      pluginRealRoot,
      ".codex-plugin/plugin.json",
    ),
  );
  if (!manifestResult.success) {
    throw new Error(manifestResult.error.issues[0]?.message ?? "invalid plugin manifest");
  }
  const manifest = manifestResult.data;
  if (manifest.name !== pluginDirectory) {
    throw new Error(
      `manifest name ${manifest.name} must match plugin directory ${pluginDirectory}`,
    );
  }

  const runtimeResult = artifactPluginRuntimeConfigSchema.safeParse(
    await readJsonReference(
      pluginRoot,
      pluginRealRoot,
      ".onmyagent/artifact.json",
    ),
  );
  if (!runtimeResult.success) {
    throw new Error(runtimeResult.error.issues[0]?.message ?? "invalid runtime config");
  }
  const runtime = runtimeResult.data;

  let skillsRoot: string | undefined;
  if (manifest.skills !== undefined) {
    skillsRoot = await verifyReference(
      pluginRoot,
      pluginRealRoot,
      manifest.skills,
      "directory",
    );
  }
  if (manifest.apps !== undefined) {
    const appManifestResult = artifactPluginAppManifestSchema.safeParse(
      await readJsonReference(
        pluginRoot,
        pluginRealRoot,
        manifest.apps,
      ),
    );
    if (!appManifestResult.success) {
      throw new Error(
        appManifestResult.error.issues[0]?.message ?? "invalid app manifest",
      );
    }
    const runtimeSkillIds = new Set(runtime.skills.map((skill) => skill.id));
    for (const app of Object.values(appManifestResult.data.apps)) {
      if (!runtimeSkillIds.has(app.id)) {
        throw new Error(`app id ${app.id} must match a declared runtime skill`);
      }
    }
  }
  for (const reference of [
    manifest.interface.composerIcon,
    manifest.interface.logo,
    manifest.interface.logoDark,
    ...manifest.interface.screenshots,
  ]) {
    if (reference !== undefined) {
      await verifyReference(pluginRoot, pluginRealRoot, reference, "file");
    }
  }

  if (skillsRoot === undefined) {
    throw new Error("runtime skills require a canonical manifest skills directory");
  }
  for (const skill of runtime.skills) {
    await verifyReference(
      pluginRoot,
      pluginRealRoot,
      relative(pluginRoot, join(skillsRoot, skill.id, "SKILL.md")),
      "file",
    );
  }
  if (runtime.runtime !== undefined) {
    await verifyReference(
      pluginRoot,
      pluginRealRoot,
      runtime.runtime.entry,
      "file",
    );
  }

  return { manifest, runtime, root: pluginRoot };
}

export async function scanArtifactPlugins(
  root: string,
): Promise<ArtifactPluginCatalog> {
  const resolvedRoot = resolve(root);
  const items: ArtifactPluginPackage[] = [];
  const diagnostics: ArtifactPluginCatalog["diagnostics"] = [];
  const entries = await readdir(resolvedRoot, { withFileTypes: true });

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      items.push(await loadArtifactPlugin(resolvedRoot, entry.name));
    } catch (error) {
      diagnostics.push({
        pluginDirectory: entry.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { items, diagnostics };
}

export function getArtifactPlugin(
  catalog: ArtifactPluginCatalog,
  id: string,
): ArtifactPluginPackage | undefined {
  return catalog.items.find((item) => item.manifest.name === id);
}
