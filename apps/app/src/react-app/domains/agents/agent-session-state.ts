export type AssistantSessionCategory = "code" | "office";

const ASSISTANT_SESSION_KEY = "onmyagent:assistantSessionIds";
const ASSISTANT_SESSION_CATEGORY_KEY = "onmyagent:assistantSessionCategoryById";
const EXPERT_SESSION_KEY = "onmyagent:expertSessionIds";
const AGENT_ID_BY_SESSION_KEY = "onmyagent:customAgentBySessionId";

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
  sessionId: string,
): AssistantSessionCategory {
  if (typeof localStorage === "undefined") return "office";
  try {
    const raw = localStorage.getItem(ASSISTANT_SESSION_CATEGORY_KEY);
    if (!raw) return "office";
    const map = JSON.parse(raw) as Record<string, string>;
    return map[sessionId] === "code" ? "code" : "office";
  } catch {
    return "office";
  }
}

export function writeAssistantSessionCategory(
  sessionId: string,
  category: AssistantSessionCategory,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(ASSISTANT_SESSION_CATEGORY_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[sessionId] = category;
    localStorage.setItem(ASSISTANT_SESSION_CATEGORY_KEY, JSON.stringify(map));
  } catch {
  }
}

let pendingAssistantSessionCategory: AssistantSessionCategory = "office";
export function setPendingAssistantSessionCategory(
  category: AssistantSessionCategory,
): void {
  pendingAssistantSessionCategory = category;
}

export function consumePendingAssistantSessionCategory(): AssistantSessionCategory {
  const value = pendingAssistantSessionCategory;
  pendingAssistantSessionCategory = "office";
  return value;
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

function readCustomAgentSessionIds(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const agentRaw = localStorage.getItem(AGENT_ID_BY_SESSION_KEY);
    if (!agentRaw) return [];
    const parsed: unknown = JSON.parse(agentRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed).flatMap(([sessionId, agentId]) =>
      typeof agentId === "string" && agentId ? [sessionId] : [],
    );
  } catch {
    return [];
  }
}

function readExpertSessionIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const agentSessionIds = readCustomAgentSessionIds();
    const raw = localStorage.getItem(EXPERT_SESSION_KEY);
    if (raw !== null) {
      const arr = JSON.parse(raw);
      const ids = new Set(
        Array.isArray(arr) ? arr.filter((id): id is string => typeof id === "string") : [],
      );
      let changed = false;
      for (const sessionId of agentSessionIds) {
        if (ids.has(sessionId)) continue;
        ids.add(sessionId);
        changed = true;
      }
      if (changed) {
        localStorage.setItem(EXPERT_SESSION_KEY, JSON.stringify(Array.from(ids)));
      }
      return ids;
    }
    const seeds = agentSessionIds;
    localStorage.setItem(EXPERT_SESSION_KEY, JSON.stringify(seeds));
    return new Set(seeds);
  } catch {
    return new Set();
  }
}

export function isExpertSession(sessionId: string): boolean {
  return readExpertSessionIds().has(sessionId);
}

export function addExpertSession(sessionId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const ids = readExpertSessionIds();
    if (ids.has(sessionId)) return;
    ids.add(sessionId);
    localStorage.setItem(EXPERT_SESSION_KEY, JSON.stringify(Array.from(ids)));
  } catch {
  }
}

export function removeExpertSession(sessionId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const ids = readExpertSessionIds();
    if (!ids.has(sessionId)) return;
    ids.delete(sessionId);
    localStorage.setItem(EXPERT_SESSION_KEY, JSON.stringify(Array.from(ids)));
  } catch {
  }
}

let pendingAssistantTask = false;
export function setPendingAssistantTask(value: boolean): void {
  pendingAssistantTask = value;
}

export function consumePendingAssistantTask(): boolean {
  const value = pendingAssistantTask;
  pendingAssistantTask = false;
  return value;
}

let pendingExpertTask = false;
export function setPendingExpertTask(value: boolean): void {
  pendingExpertTask = value;
}

export function consumePendingExpertTask(): boolean {
  const value = pendingExpertTask;
  pendingExpertTask = false;
  return value;
}
