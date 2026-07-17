import {
  artifactPluginEnablementPath,
  readArtifactPluginEnablement,
} from "./artifact-plugin-enablement.js";
import { scanArtifactPlugins } from "./artifact-plugin-registry.js";
import { bundledArtifactPluginsDir } from "../workspace/workspace-files.js";

const BROWSER_PLUGIN_ID = "browser";
const BROWSER_SKILL_ID = "browser-automation";

/**
 * Whether the bundled Browser artifact plugin (and its automation skill)
 * are effectively enabled. Defaults to true when the package is absent so
 * legacy installs keep working until the package is present.
 */
export async function isBrowserAutomationEnabled(
  configPath?: string,
): Promise<boolean> {
  const root = bundledArtifactPluginsDir();
  if (!root) return true;

  const catalog = await scanArtifactPlugins(root);
  const plugin = catalog.items.find(
    (item) => item.manifest.name === BROWSER_PLUGIN_ID,
  );
  if (!plugin) return true;

  const resolvedConfigPath =
    configPath ??
    (process.env.ONMYAGENT_SERVER_CONFIG?.trim() || undefined);
  const enablement = await readArtifactPluginEnablement(
    artifactPluginEnablementPath(resolvedConfigPath),
  );
  const pluginState = enablement.plugins[BROWSER_PLUGIN_ID];
  if (pluginState?.enabled === false) return false;

  const skillDefault =
    plugin.runtime.skills.find((skill) => skill.id === BROWSER_SKILL_ID)
      ?.defaultEnabled ?? true;
  const skillEnabled =
    pluginState?.skills[BROWSER_SKILL_ID] ?? skillDefault;
  return skillEnabled !== false;
}
