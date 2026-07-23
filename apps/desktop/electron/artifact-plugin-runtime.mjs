import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  artifactPluginEnablementSchema,
  artifactPluginManifestSchema,
  artifactPluginRuntimeConfigSchema,
} from "@onmyagent/types/artifact-plugin";

const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pluginIdSchema = z.string().regex(PLUGIN_ID);
export const ARTIFACT_PLUGIN_SKILL_IDS = Object.freeze([
  "browser-automation",
  "documents",
  "pdf",
  "spreadsheets",
  "excel-live-control",
]);
const artifactPluginAppManifestSchema = z.object({
  apps: z.record(
    pluginIdSchema,
    z.object({
      id: pluginIdSchema,
      category: z.string().min(1),
    }).strict(),
  ),
}).strict();

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertRelativePluginPath(reference) {
  if (
    typeof reference !== "string" ||
    reference.length === 0 ||
    reference.startsWith("/") ||
    reference.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(reference) ||
    reference.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`reference must stay inside the plugin root: ${String(reference)}`);
  }
}

async function readJsonReference(pluginRoot, pluginRealRoot, reference) {
  const file = await verifyReference(pluginRoot, pluginRealRoot, reference, "file");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`referenced file must contain valid JSON: ${reference}`);
  }
}

async function verifyReference(pluginRoot, pluginRealRoot, reference, kind) {
  assertRelativePluginPath(reference);
  const target = path.resolve(pluginRoot, reference);
  if (!isWithin(pluginRoot, target)) {
    throw new Error(`reference must stay inside the plugin root: ${reference}`);
  }
  let resolved;
  try {
    resolved = await realpath(target);
  } catch {
    throw new Error(`referenced path does not exist: ${reference}`);
  }
  if (!isWithin(pluginRealRoot, resolved)) {
    throw new Error(`reference must stay inside the plugin root: ${reference}`);
  }
  const entry = await stat(resolved);
  if (kind === "file" ? !entry.isFile() : !entry.isDirectory()) {
    throw new Error(`referenced path must be a ${kind}: ${reference}`);
  }
  return target;
}

async function loadPlugin(root, pluginDirectory) {
  const pluginRoot = path.join(root, pluginDirectory);
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
    throw new Error(`manifest name ${manifest.name} must match plugin directory ${pluginDirectory}`);
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
  if (manifest.skills === undefined) {
    throw new Error("runtime skills require a canonical manifest skills directory");
  }
  const skillsRoot = await verifyReference(
    pluginRoot,
    pluginRealRoot,
    manifest.skills,
    "directory",
  );

  if (manifest.apps !== undefined) {
    const appManifestResult = artifactPluginAppManifestSchema.safeParse(
      await readJsonReference(pluginRoot, pluginRealRoot, manifest.apps),
    );
    if (!appManifestResult.success) {
      throw new Error(appManifestResult.error.issues[0]?.message ?? "invalid app manifest");
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
    runtime.runtime?.entry,
  ]) {
    if (reference !== undefined) {
      await verifyReference(pluginRoot, pluginRealRoot, reference, "file");
    }
  }

  const skills = [];
  for (const skill of runtime.skills) {
    const sourcePath = path.join(skillsRoot, skill.id);
    await verifyReference(
      pluginRoot,
      pluginRealRoot,
      path.relative(pluginRoot, path.join(sourcePath, "SKILL.md")),
      "file",
    );
    skills.push({ ...skill, sourcePath });
  }
  return { pluginId: pluginDirectory, root: pluginRoot, skills };
}

export async function scanBundledArtifactPlugins(root) {
  const resolvedRoot = path.resolve(root);
  const items = [];
  const diagnostics = [];
  let entries;
  try {
    entries = await readdir(resolvedRoot, { withFileTypes: true });
  } catch (error) {
    return {
      items,
      diagnostics: [{
        pluginDirectory: path.basename(resolvedRoot),
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    try {
      items.push(await loadPlugin(resolvedRoot, entry.name));
    } catch (error) {
      diagnostics.push({
        pluginDirectory: entry.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { items, diagnostics };
}

function validateEnablement(value) {
  return artifactPluginEnablementSchema.parse(value);
}

export function artifactPluginEnablementPath(serverConfigPath) {
  const configDirectory = serverConfigPath
    ? path.dirname(serverConfigPath)
    : path.join(os.homedir(), ".config", "onmyagent");
  return path.join(configDirectory, "artifact-plugins.json");
}

/**
 * @param {{ pluginRoot?: string, enablementPath?: string }} [input]
 */
export async function isBrowserAutomationSkillEnabled(input = {}) {
  const pluginRoot = input.pluginRoot;
  const enablementPath = input.enablementPath;
  if (!pluginRoot || !existsSync(pluginRoot)) return true;
  const catalog = await scanBundledArtifactPlugins(pluginRoot);
  const browserPlugin = catalog.items.find((plugin) => plugin.pluginId === "browser");
  if (!browserPlugin) return true;
  const snapshot = await readArtifactPluginEnablementSnapshot({
    enablementPath:
      enablementPath ??
      artifactPluginEnablementPath(
        process.env.ONMYAGENT_SERVER_CONFIG?.trim() || undefined,
      ),
    catalog,
  });
  return snapshot.enabledSkillIds.has("browser-automation");
}

export async function readArtifactPluginEnablementSnapshot({ enablementPath, catalog }) {
  let state = { plugins: {} };
  if (existsSync(enablementPath)) {
    try {
      state = validateEnablement(JSON.parse(await readFile(enablementPath, "utf8")));
    } catch (error) {
      return {
        enabledSkillIds: new Set(),
        diagnostics: [{
          path: enablementPath,
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }
  const enabledSkillIds = new Set();
  for (const plugin of catalog.items) {
    const pluginState = state.plugins[plugin.pluginId];
    if (pluginState?.enabled === false) continue;
    for (const skill of plugin.skills) {
      if ((pluginState?.skills[skill.id] ?? skill.defaultEnabled) === true) {
        enabledSkillIds.add(skill.id);
      }
    }
  }
  return { enabledSkillIds, diagnostics: [] };
}

async function destinationState(destinationPath, pluginRealRoot) {
  let entry;
  try {
    entry = await lstat(destinationPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }
  if (!entry.isSymbolicLink()) return { kind: "conflict" };
  try {
    const resolved = await realpath(destinationPath);
    return isWithin(pluginRealRoot, resolved)
      ? { kind: "owned", resolved }
      : { kind: "conflict" };
  } catch {
    return { kind: "conflict" };
  }
}

export async function materializeEnabledArtifactSkills({
  pluginRoot,
  managedSkillsRoot,
  enabledSkillIds,
}) {
  const catalog = await scanBundledArtifactPlugins(pluginRoot);
  const diagnostics = [...catalog.diagnostics];
  const pluginRealRoot = await realpath(pluginRoot);
  await mkdir(managedSkillsRoot, { recursive: true });
  const desired = new Map();
  for (const plugin of catalog.items) {
    for (const skill of plugin.skills) {
      if (!enabledSkillIds.has(skill.id)) continue;
      if (desired.has(skill.id)) {
        diagnostics.push({
          pluginDirectory: plugin.pluginId,
          message: `duplicate enabled skill id: ${skill.id}`,
        });
        continue;
      }
      desired.set(skill.id, { pluginId: plugin.pluginId, ...skill });
    }
  }

  const managedEntries = await readdir(managedSkillsRoot, { withFileTypes: true });
  for (const entry of managedEntries) {
    if (desired.has(entry.name)) continue;
    const destinationPath = path.join(managedSkillsRoot, entry.name);
    const state = await destinationState(destinationPath, pluginRealRoot);
    if (state.kind === "owned") await rm(destinationPath);
  }

  const items = [];
  for (const [skillId, skill] of desired) {
    const destinationPath = path.join(managedSkillsRoot, skillId);
    const state = await destinationState(destinationPath, pluginRealRoot);
    const sourcePath = await realpath(skill.sourcePath);
    // Artifact skill ids are reserved. A *stale symlink* left by an older
    // bundled-skills materialize (outside the plugin root) must be reclaimed.
    // Real directories at the destination are treated as user conflicts and
    // preserved.
    if (state.kind === "conflict") {
      let isSymlink = false;
      try {
        isSymlink = (await lstat(destinationPath)).isSymbolicLink();
      } catch {
        isSymlink = false;
      }
      if (!isSymlink) {
        diagnostics.push({
          pluginDirectory: skill.pluginId,
          message: `preserved non-owned skill destination: ${destinationPath}`,
        });
        continue;
      }
      try {
        await rm(destinationPath, { recursive: true, force: true });
      } catch (error) {
        diagnostics.push({
          pluginDirectory: skill.pluginId,
          message: `could not reclaim skill destination ${destinationPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        continue;
      }
    } else if (state.kind === "owned" && state.resolved !== sourcePath) {
      await rm(destinationPath);
    }
    const after = await destinationState(destinationPath, pluginRealRoot);
    if (after.kind === "missing") {
      await symlink(
        sourcePath,
        destinationPath,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    items.push({
      pluginId: skill.pluginId,
      skillId,
      sourcePath,
      destinationPath,
    });
  }
  return { items, diagnostics };
}

export async function materializeLegacySkillLinks({
  skillDirs,
  managedSkillsRoot,
  reservedSkillIds = new Set(ARTIFACT_PLUGIN_SKILL_IDS),
}) {
  await mkdir(managedSkillsRoot, { recursive: true });
  const linked = new Set();
  const items = [];
  for (const skillDir of skillDirs) {
    const skillId = path.basename(skillDir);
    if (reservedSkillIds.has(skillId) || linked.has(skillId)) continue;
    linked.add(skillId);
    const destinationPath = path.join(managedSkillsRoot, skillId);
    try {
      await symlink(
        skillDir,
        destinationPath,
        process.platform === "win32" ? "junction" : "dir",
      );
      items.push({ skillId, sourcePath: skillDir, destinationPath });
    } catch {
      // Managed config preparation must preserve an existing destination.
    }
  }
  return items;
}
