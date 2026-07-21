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

/** Zero-width / BOM characters IME and rich editors sometimes inject into tokens. */
const INVISIBLE_TOKEN_CHARS = /[\u200B-\u200D\uFEFF]/gu;

/**
 * Extract the trailing `/query` token used by the composer slash skill menu.
 *
 * Lexical serializes multi-paragraph roots with `\n` and can leave a trailing
 * newline after the caret line — strip only trailing newlines so `/obsidian\n`
 * still counts as an active query (while `/obsidian ` with a real space closes).
 */
export function matchComposerSlashQuery(draft: string): {
  open: boolean;
  query: string;
} {
  const text = draft.replace(/[\n\r]+$/u, "");
  const match = text.match(/\/([^\s/]*)$/u);
  if (!match) return { open: false, query: "" };
  const query = (match[1] ?? "").replace(INVISIBLE_TOKEN_CHARS, "");
  return { open: true, query };
}

export function filterToolMenuItems<Item>(
  items: Item[],
  query: string,
  getSearchText: (item: Item) => string,
): Item[] {
  const normalizedQuery = query.trim().replace(INVISIBLE_TOKEN_CHARS, "");
  if (!normalizedQuery) return items;

  // Rank matches (better UX for long skill catalogs) instead of preserving
  // source order among hits. Empty → no matches.
  const rows = items.map((item, index) => ({
    item,
    index,
    text: getSearchText(item),
  }));
  const results = fuzzysort.go(normalizedQuery, rows, {
    key: "text",
    limit: 10_000,
  });
  return results.map((entry) => entry.obj.item);
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
