/**
 * Shared knowledge-search matching for the in-process helper and the
 * generated OpenCode plugin. Treat hyphen / underscore / slash like spaces
 * so "Getting started" hits getting-started.md (live smoke miss).
 */

export function foldKnowledgeNeedle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[-_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function knowledgeTextMatchesQuery(haystack, query) {
  const rawNeedle = String(query ?? "")
    .toLowerCase()
    .trim();
  if (!rawNeedle) return false;
  const rawHay = String(haystack ?? "").toLowerCase();
  if (rawHay.includes(rawNeedle)) return true;
  const foldedNeedle = foldKnowledgeNeedle(query);
  if (!foldedNeedle) return false;
  return foldKnowledgeNeedle(haystack).includes(foldedNeedle);
}

/** Inlined into generated knowledge-search.mjs (OpenCode child has no product imports). */
export const KNOWLEDGE_MATCH_INLINE_SOURCE = `const foldKnowledgeNeedle = (value) => String(value ?? "").toLowerCase().replace(/[-_./]+/g, " ").replace(/\\s+/g, " ").trim()
const knowledgeTextMatchesQuery = (haystack, query) => {
  const rawNeedle = String(query ?? "").toLowerCase().trim()
  if (!rawNeedle) return false
  const rawHay = String(haystack ?? "").toLowerCase()
  if (rawHay.includes(rawNeedle)) return true
  const foldedNeedle = foldKnowledgeNeedle(query)
  if (!foldedNeedle) return false
  return foldKnowledgeNeedle(haystack).includes(foldedNeedle)
}`;
