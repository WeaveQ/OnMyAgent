import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  artifactPluginEnablementSchema,
  type ArtifactPluginEnablement,
} from "@onmyagent/types/artifact-plugin";
import type { ArtifactPluginCatalog } from "./artifact-plugin-registry.js";

const emptyEnablement = (): ArtifactPluginEnablement => ({ plugins: {} });
const enablementMutationQueues = new Map<string, Promise<void>>();

async function withEnablementMutationQueue<T>(
  path: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const key = resolve(path);
  const previous = enablementMutationQueues.get(key) ?? Promise.resolve();
  const result = previous.then(mutation, mutation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  enablementMutationQueues.set(key, tail);
  try {
    return await result;
  } finally {
    if (enablementMutationQueues.get(key) === tail) {
      enablementMutationQueues.delete(key);
    }
  }
}

export function artifactPluginEnablementPath(configPath?: string): string {
  const configDirectory = configPath
    ? dirname(configPath)
    : join(homedir(), ".config", "onmyagent");
  return join(configDirectory, "artifact-plugins.json");
}

export async function readArtifactPluginEnablement(
  path: string,
): Promise<ArtifactPluginEnablement> {
  try {
    return artifactPluginEnablementSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyEnablement();
    }
    throw error;
  }
}

export async function writeArtifactPluginEnablement(
  path: string,
  state: ArtifactPluginEnablement,
): Promise<void> {
  const parsed = artifactPluginEnablementSchema.parse(state);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function updatePluginEnablement(
  path: string,
  pluginId: string,
  enabled: boolean,
): Promise<ArtifactPluginEnablement> {
  return withEnablementMutationQueue(path, async () => {
    const state = await readArtifactPluginEnablement(path);
    const current = state.plugins[pluginId];
    const next: ArtifactPluginEnablement = {
      plugins: {
        ...state.plugins,
        [pluginId]: {
          enabled,
          skills: current?.skills ?? {},
        },
      },
    };
    await writeArtifactPluginEnablement(path, next);
    return next;
  });
}

export async function updateSkillEnablement(
  path: string,
  pluginId: string,
  skillId: string,
  enabled: boolean,
): Promise<ArtifactPluginEnablement> {
  return withEnablementMutationQueue(path, async () => {
    const state = await readArtifactPluginEnablement(path);
    const current = state.plugins[pluginId];
    const next: ArtifactPluginEnablement = {
      plugins: {
        ...state.plugins,
        [pluginId]: {
          enabled: current?.enabled ?? true,
          skills: {
            ...(current?.skills ?? {}),
            [skillId]: enabled,
          },
        },
      },
    };
    await writeArtifactPluginEnablement(path, next);
    return next;
  });
}

export function resolveEffectiveArtifactSkills(
  catalog: ArtifactPluginCatalog,
  enablement: ArtifactPluginEnablement,
): Set<string> {
  const effective = new Set<string>();
  for (const plugin of catalog.items) {
    const pluginState = enablement.plugins[plugin.manifest.name];
    if (pluginState?.enabled === false) continue;
    for (const skill of plugin.runtime.skills) {
      const enabled = pluginState?.skills[skill.id] ?? skill.defaultEnabled;
      if (enabled) effective.add(skill.id);
    }
  }
  return effective;
}
