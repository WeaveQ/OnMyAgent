/**
 * Parse/strip the model-facing "user uploaded files" instruction block so the
 * transcript can show composer-like attachment chips instead of raw paths.
 */

export const USER_UPLOAD_INSTRUCTION_MARKER =
  "The user uploaded the following files. Do not treat them as native model file inputs";

export type ParsedUserUploadFile = {
  name: string;
  mime: string;
  absolutePath: string;
  relativePath: string;
};

// - name (mime): /abs/path (workspace-relative path: rel)
const UPLOAD_FILE_LINE_RE =
  /^- (.+?) \(([^)]+)\): (.+?) \(workspace-relative path: (.+?)\)\s*$/;

export function isUserUploadInstructionText(text: string): boolean {
  return text.includes(USER_UPLOAD_INSTRUCTION_MARKER);
}

export function parseUserUploadInstructionBlock(text: string): {
  remainingText: string;
  files: ParsedUserUploadFile[];
} {
  const markerIndex = text.indexOf(USER_UPLOAD_INSTRUCTION_MARKER);
  if (markerIndex < 0) {
    return { remainingText: text, files: [] };
  }

  const remainingText = text.slice(0, markerIndex).trimEnd();
  const block = text.slice(markerIndex);
  const files: ParsedUserUploadFile[] = [];
  for (const line of block.split("\n")) {
    const match = line.trim().match(UPLOAD_FILE_LINE_RE);
    if (!match) continue;
    const name = match[1]?.trim() ?? "";
    const mime = match[2]?.trim() || "application/octet-stream";
    const absolutePath = match[3]?.trim() ?? "";
    const relativePath = match[4]?.trim() ?? "";
    if (!name || !absolutePath) continue;
    files.push({ name, mime, absolutePath, relativePath });
  }
  return { remainingText, files };
}

export function fileUrlFromAbsolutePath(absolutePath: string): string {
  const trimmed = absolutePath.trim();
  if (!trimmed) return "";
  if (/^file:\/\//i.test(trimmed)) return trimmed;
  // Windows absolute paths need an extra slash after file://
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return `file:///${trimmed.replace(/\\/g, "/")}`;
  }
  return `file://${trimmed}`;
}

export function absolutePathFromFileUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (!/^file:\/\//i.test(trimmed)) return trimmed;
  let path = trimmed.replace(/^file:\/\//i, "");
  // file:///C:/foo → C:/foo
  if (/^\/[a-zA-Z]:\//.test(path)) {
    path = path.slice(1);
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
