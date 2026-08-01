/**
 * Sheet preview routing: binary Office workbooks use the Electron
 * OfficeFilePreview overlay (same as Files); CSV/TSV stay on the built-in editor.
 * Binary xlsx is preview-only — no silent write-back through the viewer.
 */

/** Binary spreadsheet extensions that use the native Office overlay preview. */
export const BINARY_SPREADSHEET_EXTENSION_RE =
  /\.(xlsx|xls|xlsm|xlsb|xlt|xltx|xltm|ods|fods|numbers)$/i;

/** Delimited text sheets edited in-app (not via Office overlay). */
export const TEXT_SPREADSHEET_EXTENSION_RE = /\.(csv|tsv)$/i;

export function isBinarySpreadsheetPath(pathOrName: string): boolean {
  const name = String(pathOrName ?? "").trim();
  if (!name) return false;
  return BINARY_SPREADSHEET_EXTENSION_RE.test(name);
}

export function isTextSpreadsheetPath(pathOrName: string): boolean {
  const name = String(pathOrName ?? "").trim();
  if (!name) return false;
  return TEXT_SPREADSHEET_EXTENSION_RE.test(name);
}

function looksLikeAbsoluteFilesystemPath(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  if (raw.startsWith("/")) return true;
  // Windows drive path
  if (/^[A-Za-z]:[\\/]/.test(raw)) return true;
  return false;
}

/**
 * Whether the session artifact surface should mount OfficeFilePreview for a sheet.
 * Requires:
 * - Electron Office preview bridge available (same gate as Files/side-panel)
 * - local workspace (not remote)
 * - binary spreadsheet extension
 * - resolvable absolute filesystem path
 *
 * When the bridge is missing, callers must fall through to download/reveal
 * (UnsupportedBinaryNotice) — never mount an empty OfficeFilePreview no-op.
 */
export function shouldPreviewBinarySheetViaOfficeOverlay(input: {
  preview: string;
  pathOrName: string;
  isRemoteWorkspace?: boolean;
  absoluteFilePath?: string | null;
  /**
   * Explicit Electron/runtime preview availability.
   * Pass `isElectronRuntime()` (and/or artifactPreview present) from the host.
   * Defaults to false so non-Electron cannot pretend-preview.
   */
  officePreviewAvailable?: boolean;
}): boolean {
  if (!input.officePreviewAvailable) return false;
  if (input.preview !== "sheet") return false;
  if (input.isRemoteWorkspace) return false;
  if (!isBinarySpreadsheetPath(input.pathOrName)) return false;
  const abs = String(input.absoluteFilePath ?? "").trim();
  if (!abs || !looksLikeAbsoluteFilesystemPath(abs)) return false;
  return true;
}
