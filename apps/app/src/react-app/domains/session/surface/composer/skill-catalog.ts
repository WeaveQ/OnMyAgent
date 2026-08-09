/**
 * Pure skill/command catalog builders + menu filters for the session composer.
 */
import type { CloudImportedPlugin, CloudImportedPluginFile } from "../../../../../app/cloud/import-state";
import type {
  McpServerEntry,
  McpStatusMap,
  SkillCard,
  SlashCommandOption,
} from "../../../../../app/types";
import {
  getMcpServerName,
  type McpDirectoryInfo,
} from "../../../../../app/constants";
import {
  filterToolMenuItems,
  pluginSkillFileSearchText,
} from "./tool-menu-model";
import {
  mcpServerDescription,
  toReactMcpStatus,
  type McpServerStatus,
} from "./composer-helpers";
import { sortWithPinnedFirst } from "@/react-app/domains/plugins";

/** Same title priority as skills marketplace cards. */
export function skillCardDisplayName(skill: {
  name: string;
  displayNameZh?: string | null;
  displayNameEn?: string | null;
}): string {
  return (
    skill.displayNameZh?.trim() ||
    skill.displayNameEn?.trim() ||
    skill.name
  );
}

/** Same description priority as skills marketplace cards. */
export function skillCardDescription(skill: {
  description?: string | null;
  descriptionZh?: string | null;
  descriptionEn?: string | null;
  trigger?: string | null;
}): string | undefined {
  const candidates = [
    skill.descriptionZh,
    skill.descriptionEn,
    skill.description,
    skill.trigger,
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (!text) continue;
    if (/^>-?$/.test(text) || /^\|[-+]?$/.test(text) || /^>$/.test(text)) continue;
    if (text.length < 3) continue;
    return text;
  }
  return undefined;
}

export function buildOnmyagentInstalledNames(skills: SkillCard[]): Set<string> {
  const names = new Set<string>();
  for (const skill of skills) {
    if (skill.scope === "onmyagent") {
      const name = String(skill.name ?? "").trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Composer shows all three product buckets:
 * - onmyagent: profile installed + builtin (preinstall/market into user root)
 * - builtin: artifact plugins
 * - local: project / legacy / third-party discovered skills
 */
export function isComposerManagedSkill(skill: SkillCard): boolean {
  return (
    skill.scope === "onmyagent" ||
    skill.scope === "builtin" ||
    skill.scope === "local"
  );
}

/**
 * Shared skill catalog for `+` skills flyout and `/` slash menu so count + order match.
 * Includes installed, builtin, and local discovered skills.
 */
export function buildCombinedSkillItems(
  skills: SkillCard[],
  commands: SlashCommandOption[],
  onmyagentInstalledNames: Set<string>,
): SlashCommandOption[] {
  const byName = new Map<string, SlashCommandOption>();
  for (const skill of skills) {
    if (!isComposerManagedSkill(skill)) continue;
    const name = String(skill.name ?? "").trim();
    if (!name) continue;
    const label = skillCardDisplayName(skill);
    byName.set(name, {
      id: `skill:${name}`,
      name,
      label: label !== name ? label : undefined,
      description: skillCardDescription(skill) ?? skill.description,
      source: "skill",
    });
  }
  const managedNames = new Set(byName.keys());
  for (const command of commands) {
    if (command.source === "mcp") continue;
    const name = String(command.name ?? "").trim();
    if (!name) continue;
    // Drop OpenCode skill rows that are not installed/builtin (e.g. raw package tree).
    if (command.source === "skill" || !command.source) {
      if (!managedNames.has(name)) continue;
    } else if (!managedNames.has(name)) {
      // Non-skill commands stay out of the skill flyout catalog.
      continue;
    }
    const existing = byName.get(name);
    // Stable pin key: skill:<name> so + menu pins still match slash rows.
    byName.set(name, {
      ...command,
      id: command.source === "skill" || !command.source ? `skill:${name}` : command.id,
      name,
      // Keep marketplace-style label from SkillCard when OpenCode row has none.
      label: command.label?.trim() || existing?.label,
      description: existing?.description || command.description,
    });
  }
  const alpha = (left: SlashCommandOption, right: SlashCommandOption) => {
    const leftTitle = left.label?.trim() || left.name;
    const rightTitle = right.label?.trim() || right.name;
    return leftTitle.localeCompare(rightTitle, "zh-Hans-CN", {
      sensitivity: "base",
    });
  };
  // OnMyAgent-installed first (alpha), then builtin/rest (alpha).
  const installed: SlashCommandOption[] = [];
  const rest: SlashCommandOption[] = [];
  for (const item of byName.values()) {
    if (onmyagentInstalledNames.has(item.name)) installed.push(item);
    else rest.push(item);
  }
  installed.sort(alpha);
  rest.sort(alpha);
  return [...installed, ...rest];
}

/** Resolve pin storage key for a catalog row (supports legacy cmd:/skill: aliases). */
export function resolveSkillPinId(
  item: SlashCommandOption,
  pinnedSkillIds: string[],
): string {
  if (pinnedSkillIds.includes(item.id)) return item.id;
  const skillId = `skill:${item.name}`;
  if (pinnedSkillIds.includes(skillId)) return skillId;
  const cmdId = `cmd:${item.name}`;
  if (pinnedSkillIds.includes(cmdId)) return cmdId;
  return item.id;
}

export function orderSkillCatalog(
  combinedSkillItems: SlashCommandOption[],
  pinnedSkillIds: string[],
): SlashCommandOption[] {
  return sortWithPinnedFirst(combinedSkillItems, pinnedSkillIds, (item) =>
    resolveSkillPinId(item, pinnedSkillIds),
  );
}

/** Slash menu is skills/commands only — connectors live under + → connectors. */
export function filterSlashSkillItems(
  skillCatalogOrdered: SlashCommandOption[],
  slashOpen: boolean,
  slashQuery: string,
): SlashCommandOption[] {
  if (!slashOpen) return [];
  // Weight the name twice so `/obsidian` ranks the skill itself above long
  // descriptions that only fuzzy-match a few letters.
  return slashQuery.trim()
    ? filterToolMenuItems(
        skillCatalogOrdered,
        slashQuery,
        (item) =>
          `${item.label ?? ""} ${item.name} ${item.name} ${item.description ?? ""}`,
      )
    : skillCatalogOrdered;
}

export function filterSkillMenuItems(
  skillCatalogOrdered: SlashCommandOption[],
  skillSearchQuery: string,
): SlashCommandOption[] {
  return filterToolMenuItems(
    skillCatalogOrdered,
    skillSearchQuery,
    (item) => `${item.label ?? ""} ${item.name} ${item.name} ${item.description ?? ""}`,
  );
}

export function filterPluginSkillFiles(
  pluginSkillFiles: CloudImportedPluginFile[],
  skillSearchQuery: string,
): CloudImportedPluginFile[] {
  return filterToolMenuItems(
    pluginSkillFiles,
    skillSearchQuery,
    pluginSkillFileSearchText,
  );
}

export type ActiveMcpItem = {
  entry: McpServerEntry;
  status: McpServerStatus;
};

/**
 * MCP server names owned by built-in extension tiles (e.g. computer-use).
 * Those must not also appear under "Configured MCP" or the connector count
 * double-counts the same capability.
 */
export function builtInExtensionMcpServerNames(
  extensions: McpDirectoryInfo[],
): Set<string> {
  const names = new Set<string>();
  for (const entry of extensions) {
    names.add(getMcpServerName(entry));
    if (entry.id) names.add(entry.id);
    for (const resource of entry.extensionManifest?.resources ?? []) {
      if (resource.type === "mcp" && resource.mcpServerName) {
        names.add(resource.mcpServerName);
      }
    }
  }
  return names;
}

export function buildActiveMcpItems(
  mcpServers: McpServerEntry[],
  mcpStatuses: McpStatusMap,
  excludeServerNames?: Iterable<string>,
): ActiveMcpItem[] {
  const exclude =
    excludeServerNames != null ? new Set(excludeServerNames) : null;
  return mcpServers
    .filter((entry) => !exclude?.has(entry.name))
    .map((entry) => ({
      entry,
      status: toReactMcpStatus(entry.name, entry, mcpStatuses),
    }));
}

export function filterMcpMenuItems(
  activeMcpItems: ActiveMcpItem[],
  connectorSearchQuery: string,
): ActiveMcpItem[] {
  return filterToolMenuItems(
    activeMcpItems,
    connectorSearchQuery,
    ({ entry }) => `${entry.name} ${mcpServerDescription(entry)}`,
  );
}

export function filterComposerExtensions(
  composerExtensions: McpDirectoryInfo[],
  connectorSearchQuery: string,
): McpDirectoryInfo[] {
  return filterToolMenuItems(
    composerExtensions,
    connectorSearchQuery,
    (entry) => `${entry.name} ${entry.description}`,
  );
}

export function collectPluginSkillFiles(
  importedPlugins: CloudImportedPlugin[],
): CloudImportedPluginFile[] {
  return importedPlugins.flatMap((plugin) =>
    plugin.files.filter((file) => file.objectType === "command" || file.objectType === "skill"),
  );
}

/**
 * Normalize to skill:<name> and drop legacy cmd:/skill: aliases for the same name.
 * Returns the next pinned id list (max 24).
 */
export function nextPinnedSkillIds(
  current: string[],
  command: SlashCommandOption,
): string[] {
  const primaryId = `skill:${command.name}`;
  const aliases = new Set([primaryId, command.id, `cmd:${command.name}`, `skill:${command.name}`]);
  const had = current.some((id) => aliases.has(id));
  const stripped = current.filter((id) => !aliases.has(id));
  return had ? stripped : [primaryId, ...stripped].slice(0, 24);
}
