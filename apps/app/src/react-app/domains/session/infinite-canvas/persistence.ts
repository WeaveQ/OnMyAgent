import {
  CANVAS_SNAPSHOT_VERSION,
  type CanvasAssetRef,
  type CanvasSessionKey,
  type CanvasSnapshot,
  type CanvasTemplateId,
} from "./types";
import { canvasBackupStorageKey, canvasStorageKey } from "./session-key";
import type { TLEditorSnapshot } from "tldraw";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function now() {
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTldrawSnapshot(value: unknown): value is TLEditorSnapshot {
  if (!isRecord(value)) return false;
  return isRecord(value.document) && isRecord(value.session);
}

function parseAsset(value: unknown): CanvasAssetRef | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.mimeType !== "string" ||
    typeof value.size !== "number" ||
    typeof value.createdAt !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
    dataUrl: typeof value.dataUrl === "string" ? value.dataUrl : undefined,
    createdAt: value.createdAt,
  };
}

function parseTemplateId(value: unknown): CanvasTemplateId {
  if (
    value === "flowchart" ||
    value === "taskBreakdown" ||
    value === "architecture" ||
    value === "meeting" ||
    value === "expertAnalysis"
  ) {
    return value;
  }
  return "blank";
}

export function createEmptyCanvasSnapshot(key: CanvasSessionKey): CanvasSnapshot {
  const timestamp = now();
  return {
    version: CANVAS_SNAPSHOT_VERSION,
    key,
    document: null,
    templateId: "blank",
    assets: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function parseCanvasSnapshot(raw: string, key: CanvasSessionKey): CanvasSnapshot | null {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return null;
  if (parsed.version !== CANVAS_SNAPSHOT_VERSION) return null;
  if (!isRecord(parsed.key)) return null;
  if (
    parsed.key.workspaceId !== key.workspaceId ||
    parsed.key.sessionId !== key.sessionId ||
    parsed.key.surface !== key.surface
  ) {
    return null;
  }
  const assets = Array.isArray(parsed.assets)
    ? parsed.assets.flatMap((asset) => {
        const parsedAsset = parseAsset(asset);
        return parsedAsset ? [parsedAsset] : [];
      })
    : [];

  return {
    version: CANVAS_SNAPSHOT_VERSION,
    key,
    document: isTldrawSnapshot(parsed.document) ? parsed.document : null,
    templateId: parseTemplateId(parsed.templateId),
    assets,
    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : now(),
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : now(),
  };
}

export function loadCanvasSnapshot(storage: StorageLike, key: CanvasSessionKey): CanvasSnapshot {
  const storageKey = canvasStorageKey(key);
  const raw = storage.getItem(storageKey);
  if (!raw) return createEmptyCanvasSnapshot(key);

  try {
    return parseCanvasSnapshot(raw, key) ?? createEmptyCanvasSnapshot(key);
  } catch {
    storage.setItem(canvasBackupStorageKey(key), raw);
    storage.removeItem(storageKey);
    return createEmptyCanvasSnapshot(key);
  }
}

export function saveCanvasSnapshot(storage: StorageLike, snapshot: CanvasSnapshot) {
  storage.setItem(
    canvasStorageKey(snapshot.key),
    JSON.stringify({
      ...snapshot,
      updatedAt: now(),
    } satisfies CanvasSnapshot),
  );
}
