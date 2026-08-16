import type { KnowledgeVaultScope } from "./knowledge-vault-model";

export type KnowledgeSearchHit = {
  scope: KnowledgeVaultScope;
  relPath: string;
  title: string;
};

function asScope(value: unknown): KnowledgeVaultScope {
  return value === "project" || value === "expert" ? value : "user";
}

function hitFromRecord(record: Record<string, unknown>): KnowledgeSearchHit | null {
  const relPath = String(record.relPath ?? record.rel_path ?? "").trim();
  if (!relPath) return null;
  const title = String(record.title ?? "").trim() || relPath.split("/").pop() || relPath;
  return { scope: asScope(record.scope), relPath, title };
}

function hitFromSingleResult(record: Record<string, unknown>): KnowledgeSearchHit | null {
  if (record.ok === false) return null;
  return hitFromRecord(record);
}

/** Parse knowledge_search / knowledge_read / knowledge_create tool JSON. */
export function parseKnowledgeSearchHits(output: unknown): KnowledgeSearchHit[] {
  let value = output;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const rawHits = Array.isArray(record.hits)
    ? record.hits
    : Array.isArray(value)
      ? value
      : [];
  const hits: KnowledgeSearchHit[] = [];
  for (const item of rawHits) {
    if (!item || typeof item !== "object") continue;
    const hit = hitFromRecord(item as Record<string, unknown>);
    if (hit) hits.push(hit);
  }
  if (hits.length === 0) {
    const single = hitFromSingleResult(record);
    if (single) hits.push(single);
  }
  return hits;
}

export function isKnowledgeSearchToolName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === "knowledge_search" ||
    n === "knowledge_read" ||
    n === "knowledge_create" ||
    n === "knowledge_append"
  );
}
