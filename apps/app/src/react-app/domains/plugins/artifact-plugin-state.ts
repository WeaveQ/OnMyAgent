import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";

export type ArtifactPluginState = {
  get: (pluginId: string) => ArtifactPluginCatalogItem | undefined;
  list: () => ArtifactPluginCatalogItem[];
  replace: (plugins: ArtifactPluginCatalogItem[]) => void;
  subscribe: (listener: () => void) => () => void;
  setPluginEnabled: (
    pluginId: string,
    enabled: boolean,
    request: () => Promise<void>,
  ) => Promise<void>;
  setSkillEnabled: (
    pluginId: string,
    skillId: string,
    enabled: boolean,
    request: () => Promise<void>,
  ) => Promise<void>;
};

function clonePlugin(plugin: ArtifactPluginCatalogItem): ArtifactPluginCatalogItem {
  return {
    ...plugin,
    skills: plugin.skills.map((skill) => ({ ...skill })),
  };
}

export function createArtifactPluginState(
  initialPlugins: ArtifactPluginCatalogItem[],
): ArtifactPluginState {
  const plugins = new Map(
    initialPlugins.map((plugin) => [plugin.id, clonePlugin(plugin)]),
  );
  const listeners = new Set<() => void>();
  const mutationVersions = new Map<string, number>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const nextVersion = (key: string) => {
    const version = (mutationVersions.get(key) ?? 0) + 1;
    mutationVersions.set(key, version);
    return version;
  };

  return {
    get: (pluginId) => plugins.get(pluginId),
    list: () => [...plugins.values()],
    replace: (nextPlugins) => {
      plugins.clear();
      for (const plugin of nextPlugins) {
        plugins.set(plugin.id, clonePlugin(plugin));
      }
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPluginEnabled: async (pluginId, enabled, request) => {
      const plugin = plugins.get(pluginId);
      if (!plugin) throw new Error(`Unknown artifact plugin: ${pluginId}`);

      const key = `plugin:${pluginId}`;
      const version = nextVersion(key);
      const previousEnabled = plugin.enabled;
      plugin.enabled = enabled;
      emit();

      try {
        await request();
      } catch (error) {
        if (mutationVersions.get(key) === version) {
          plugin.enabled = previousEnabled;
          emit();
        }
        throw error;
      }
    },
    setSkillEnabled: async (pluginId, skillId, enabled, request) => {
      const plugin = plugins.get(pluginId);
      if (!plugin) throw new Error(`Unknown artifact plugin: ${pluginId}`);
      const skill = plugin.skills.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error(`Unknown artifact skill: ${pluginId}/${skillId}`);

      const key = `skill:${pluginId}:${skillId}`;
      const version = nextVersion(key);
      const previousEnabled = skill.enabled;
      skill.enabled = enabled;
      emit();

      try {
        await request();
      } catch (error) {
        if (mutationVersions.get(key) === version) {
          skill.enabled = previousEnabled;
          emit();
        }
        throw error;
      }
    },
  };
}
