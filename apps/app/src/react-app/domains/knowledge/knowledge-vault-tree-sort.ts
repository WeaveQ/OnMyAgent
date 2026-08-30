import { parseKnowledgeTreeSortKey, type KnowledgeTreeSortKey } from "./knowledge-vault-model";

const STORAGE_KEY = "oma.knowledge.tree-sort";

export function readKnowledgeTreeSort(): KnowledgeTreeSortKey {
  try {
    return parseKnowledgeTreeSortKey(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "name-asc";
  }
}

export function writeKnowledgeTreeSort(key: KnowledgeTreeSortKey): void {
  window.localStorage.setItem(STORAGE_KEY, key);
}
