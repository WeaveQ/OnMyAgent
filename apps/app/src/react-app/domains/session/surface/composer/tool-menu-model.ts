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
