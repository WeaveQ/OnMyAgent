const STORAGE_KEY = "oma.knowledge.favorites";

export function readKnowledgeFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeKnowledgeFavorites(keys: ReadonlySet<string>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
}

export function toggleKnowledgeFavorite(key: string): Set<string> {
  const next = readKnowledgeFavorites();
  if (next.has(key)) next.delete(key);
  else next.add(key);
  writeKnowledgeFavorites(next);
  return next;
}
