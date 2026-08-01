/**
 * Cross-surface file preview policy (all types, not only spreadsheets):
 * - when to inline vs force external open
 * - preview selection debounce
 * - Agent-bridge prompt seeding
 */

/** Skip heavy in-app text/image download above this size. */
export const INLINE_CONTENT_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Office overlay can stream larger workbooks, but cap to avoid thrashing
 * WebContentsView on multi-megabyte packs.
 */
export const OFFICE_OVERLAY_PREVIEW_MAX_BYTES = 40 * 1024 * 1024;

/** Debounce file selection before kicking off preview loads (ms). */
export const FILE_PREVIEW_SELECTION_DEBOUNCE_MS = 120;

export type FilePreviewKind =
  | "markdown"
  | "text"
  | "sheet"
  | "html"
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "browser"
  | "external"
  | "document"
  | "presentation"
  | string;

/**
 * Whether size alone should skip in-app content loading and show the
 * external-open empty state (icon card) instead.
 */
export function shouldForceExternalPreviewForSize(input: {
  sizeBytes?: number | null;
  preview: FilePreviewKind;
}): boolean {
  const size = Number(input.sizeBytes ?? 0);
  if (!Number.isFinite(size) || size <= 0) return false;

  const preview = String(input.preview ?? "");
  // Office / document / presentation: higher cap (Electron overlay reads from disk).
  if (
    preview === "sheet" ||
    preview === "document" ||
    preview === "presentation" ||
    preview === "pdf"
  ) {
    return size > OFFICE_OVERLAY_PREVIEW_MAX_BYTES;
  }
  // Text / image / html / media content fetches.
  return size > INLINE_CONTENT_PREVIEW_MAX_BYTES;
}

/**
 * Whether two selection identities refer to the same preview target
 * (used to skip reload when re-clicking the same file).
 */
export function isSamePreviewSelection(
  a: { path?: string | null; id?: string | null } | null | undefined,
  b: { path?: string | null; id?: string | null } | null | undefined,
): boolean {
  if (!a || !b) return false;
  const ap = String(a.path ?? "").trim();
  const bp = String(b.path ?? "").trim();
  if (ap && bp && ap === bp) return true;
  const ai = String(a.id ?? "").trim();
  const bi = String(b.id ?? "").trim();
  return Boolean(ai && bi && ai === bi);
}

/**
 * Instruction suffix after @mention for "Ask Agent about this file".
 * Keep short; composer already holds the path token.
 */
export function buildAskAgentFileInstruction(input: {
  fileName: string;
  preview?: FilePreviewKind;
}): string {
  const name = String(input.fileName ?? "").trim() || "file";
  const preview = String(input.preview ?? "");
  if (preview === "sheet") {
    return `请查看表格「${name}」，总结关键数据，并说明需要我确认后才能改的地方。`;
  }
  if (preview === "document" || preview === "presentation") {
    return `请查看文档「${name}」，概括要点，并给出可执行的修改建议。`;
  }
  if (preview === "image") {
    return `请查看图片「${name}」，描述内容并说明可如何处理。`;
  }
  if (preview === "pdf") {
    return `请查看 PDF「${name}」，提炼要点并给出后续处理建议。`;
  }
  return `请查看文件「${name}」，说明内容概要，并告诉我可以如何处理。`;
}
