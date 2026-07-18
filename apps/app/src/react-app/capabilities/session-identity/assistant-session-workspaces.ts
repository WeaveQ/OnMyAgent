const storageKey = "onmyagent.assistantSessionWorkspaces.v1";
export const assistantSessionWorkspacesChangedEvent =
  "onmyagent:assistant-session-workspaces-changed";

export type AssistantSessionWorkspace = {
  sessionId: string;
  ownerWorkspaceId: string;
  directory: string;
};

function readAll(): AssistantSessionWorkspace[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const sessionId = "sessionId" in item && typeof item.sessionId === "string"
        ? item.sessionId.trim()
        : "";
      const ownerWorkspaceId =
        "ownerWorkspaceId" in item && typeof item.ownerWorkspaceId === "string"
          ? item.ownerWorkspaceId.trim()
          : "";
      const directory = "directory" in item && typeof item.directory === "string"
        ? item.directory.trim()
        : "";
      return sessionId && ownerWorkspaceId && directory
        ? [{ sessionId, ownerWorkspaceId, directory }]
        : [];
    });
  } catch {
    return [];
  }
}

function writeAll(items: AssistantSessionWorkspace[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(items));
}

export function readAssistantSessionWorkspaces(ownerWorkspaceId?: string) {
  const owner = ownerWorkspaceId?.trim();
  return owner
    ? readAll().filter((item) => item.ownerWorkspaceId === owner)
    : readAll();
}

export function readAssistantSessionWorkspace(sessionId?: string | null) {
  const id = sessionId?.trim();
  if (!id) return null;
  return readAll().find((item) => item.sessionId === id) ?? null;
}

export function writeAssistantSessionWorkspace(input: AssistantSessionWorkspace) {
  const current = readAll();
  const normalized = {
    sessionId: input.sessionId.trim(),
    ownerWorkspaceId: input.ownerWorkspaceId.trim(),
    directory: input.directory.trim(),
  };
  const existing = current.find((item) => item.sessionId === normalized.sessionId);
  if (
    existing?.ownerWorkspaceId === normalized.ownerWorkspaceId &&
    existing.directory === normalized.directory
  ) return false;
  const next = current.filter((item) => item.sessionId !== normalized.sessionId);
  next.push(normalized);
  writeAll(next);
  return true;
}

export function dispatchAssistantSessionWorkspacesChanged(ownerWorkspaceId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(assistantSessionWorkspacesChangedEvent, {
    detail: { ownerWorkspaceId },
  }));
}

export function readAssistantSessionWorkspaceChangeOwner(event: Event) {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (!detail || typeof detail !== "object" || !("ownerWorkspaceId" in detail)) {
    return null;
  }
  return typeof detail.ownerWorkspaceId === "string"
    ? detail.ownerWorkspaceId
    : null;
}

export function removeAssistantSessionWorkspace(sessionId: string) {
  writeAll(readAll().filter((item) => item.sessionId !== sessionId.trim()));
}

/** Unbind every assistant session mapped to this project directory. */
export function removeAssistantSessionWorkspacesByDirectory(
  ownerWorkspaceId: string,
  directory: string,
) {
  const owner = ownerWorkspaceId.trim();
  const dir = directory.trim();
  if (!owner || !dir) return 0;
  const current = readAll();
  const next = current.filter(
    (item) =>
      !(item.ownerWorkspaceId === owner && item.directory === dir),
  );
  const removed = current.length - next.length;
  if (removed > 0) writeAll(next);
  return removed;
}
