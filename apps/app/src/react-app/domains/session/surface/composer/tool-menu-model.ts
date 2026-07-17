import fuzzysort from "fuzzysort";

export type CollaborationModeOptionKey =
  | "craft"
  | "ask"
  | "plan"
  | "planning"
  | "pursueGoal";

export function collaborationModeOptionKeys(
  variant: "office" | "legacy",
): CollaborationModeOptionKey[] {
  return variant === "office"
    ? ["craft", "ask", "plan"]
    : ["planning", "pursueGoal"];
}

export function filterToolMenuItems<Item>(
  items: Item[],
  query: string,
  getSearchText: (item: Item) => string,
): Item[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return items;
  return items.filter((item) =>
    fuzzysort.single(normalizedQuery, getSearchText(item)) !== null,
  );
}

export function formatPluginObjectType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (!normalized) return "File";
  if (normalized === "mcp") return "MCP";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

export function pluginSkillFileSearchText(file: {
  title: string;
  objectType: string;
}): string {
  return `${file.title} ${formatPluginObjectType(file.objectType)}`;
}

/** Strip noisy skill source prefixes like "(opencode - Skill)" for menu secondary lines. */
export function skillMenuDescription(description?: string | null): string {
  if (!description) return "";
  return description.replace(/^\([^)]*\)\s*/u, "").trim();
}
