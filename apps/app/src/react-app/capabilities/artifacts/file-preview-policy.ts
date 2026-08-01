/**
 * Cross-surface file preview policy (all types, not only spreadsheets):
 * - when to inline vs force external open
 * - preview selection debounce
 * - Agent-bridge prompt seeding
 */

import { t } from "../../../i18n";

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
 * Instruction after the @file mention chip for "Ask Agent about this file".
 * Do NOT re-embed the filename as plain text — the mention chip is the card;
 * duplicating the name as plain quoted text made the bubble look non-clickable.
 */
export function buildAskAgentFileInstruction(input: {
  fileName: string;
  preview?: FilePreviewKind;
}): string {
  void input.fileName;
  const preview = String(input.preview ?? "");
  if (preview === "sheet") {
    return t("files.ask_agent_instruction_sheet");
  }
  if (preview === "document" || preview === "presentation") {
    return t("files.ask_agent_instruction_document");
  }
  if (preview === "image") {
    return t("files.ask_agent_instruction_image");
  }
  if (preview === "pdf") {
    return t("files.ask_agent_instruction_pdf");
  }
  return t("files.ask_agent_instruction_generic");
}
