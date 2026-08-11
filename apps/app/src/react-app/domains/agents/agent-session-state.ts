export type AssistantSessionCategory = "office";

const ASSISTANT_SESSION_KEY = "onmyagent:assistantSessionIds";
const ASSISTANT_SESSION_CATEGORY_KEY = "onmyagent:assistantSessionCategoryById";

function readAssistantSessionIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(ASSISTANT_SESSION_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(
      Array.isArray(arr) ? arr.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function isAssistantSession(sessionId: string): boolean {
  return readAssistantSessionIds().has(sessionId);
}

export function addAssistantSession(sessionId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const ids = readAssistantSessionIds();
    if (ids.has(sessionId)) return;
    ids.add(sessionId);
    localStorage.setItem(ASSISTANT_SESSION_KEY, JSON.stringify(Array.from(ids)));
  } catch {
  }
}

export function readAssistantSessionCategory(
  _sessionId: string,
): AssistantSessionCategory {
  return "office";
}

export function writeAssistantSessionCategory(
  sessionId: string,
  _category: AssistantSessionCategory = "office",
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(ASSISTANT_SESSION_CATEGORY_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[sessionId] = "office";
    localStorage.setItem(ASSISTANT_SESSION_CATEGORY_KEY, JSON.stringify(map));
  } catch {
  }
}

export function removeAssistantSession(sessionId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const ids = readAssistantSessionIds();
    if (!ids.has(sessionId)) return;
    ids.delete(sessionId);
    localStorage.setItem(ASSISTANT_SESSION_KEY, JSON.stringify(Array.from(ids)));
  } catch {
  }
}
