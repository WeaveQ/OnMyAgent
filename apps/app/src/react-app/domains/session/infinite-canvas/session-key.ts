import type { CanvasSessionKey, CanvasSurfaceKind } from "./types";

function cleanPart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9:_-]+/g, "-").replace(/-+/g, "-");
}

export function createCanvasSessionKey(input: {
  workspaceId: string;
  sessionId: string | null | undefined;
  surface: CanvasSurfaceKind;
}): CanvasSessionKey {
  const workspaceId = cleanPart(input.workspaceId) || "workspace";
  const sessionId = cleanPart(input.sessionId ?? `draft:${workspaceId}`) || `draft:${workspaceId}`;

  return {
    workspaceId,
    sessionId,
    surface: input.surface,
  };
}

export function canvasStorageKey(key: CanvasSessionKey) {
  return `onmyagent.infiniteCanvas.v1:${key.surface}:${key.workspaceId}:${key.sessionId}`;
}

export function canvasBackupStorageKey(key: CanvasSessionKey) {
  return `${canvasStorageKey(key)}:corrupt`;
}
