import {
  artifactPluginEnablementPath,
  readArtifactPluginEnablement,
  resolveEffectiveArtifactPlugins,
} from "./artifact-plugin-enablement.js";
import { scanArtifactPlugins } from "./artifact-plugin-registry.js";
import { bundledArtifactPluginsDir } from "../workspace/workspace-files.js";

const FILE_PLUGIN_IDS = new Set(["documents", "spreadsheets", "pdf"]);

export async function buildArtifactPluginGuidance(
  configPath?: string,
): Promise<string | undefined> {
  const root = bundledArtifactPluginsDir();
  if (!root) return undefined;
  const catalog = await scanArtifactPlugins(root);
  const enablement = await readArtifactPluginEnablement(
    artifactPluginEnablementPath(
      configPath ?? (process.env.ONMYAGENT_SERVER_CONFIG?.trim() || undefined),
    ),
  );
  const plugins = resolveEffectiveArtifactPlugins(catalog, enablement).filter(
    (plugin) => FILE_PLUGIN_IDS.has(plugin.manifest.name),
  );
  if (plugins.length === 0) return undefined;

  const lines = plugins.map((plugin) => {
    const state = enablement.plugins[plugin.manifest.name];
    const skills = plugin.runtime.skills
      .filter(
        (skill) => (state?.skills[skill.id] ?? skill.defaultEnabled) === true,
      )
      .map((skill) => `\`${skill.id}\``)
      .join(", ");
    const extensions = plugin.runtime.routing.extensions
      .map((extension) => `\`${extension}\``)
      .join(", ");
    return `- ${skills}: activate for matching natural-language requests or attached files with ${extensions}.`;
  });

  return [
    "## Local file connectors",
    "",
    "The following enabled skills are available in every session. Load the matching skill before operating on a file, including when intent is expressed naturally or inferred from an attachment name/type:",
    "",
    ...lines,
    "",
    "Do not use a disabled connector. Follow the selected skill's inspect, render, and verify workflow and report exact local output paths.",
  ].join("\n");
}
