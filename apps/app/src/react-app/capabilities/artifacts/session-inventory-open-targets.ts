import { classifyOpenTarget, isLikelyUserUploadArtifactPath, type OpenTarget } from "./open-target";

/** End-user product files. Cards come from disk inventory + this set, not Chinese labels. */
export const CONTENT_DELIVERABLE_EXTENSIONS = new Set([
  ".xlsx",
  ".xlsm",
  ".xls",
  ".csv",
  ".tsv",
  ".docx",
  ".doc",
  ".pdf",
  ".pptx",
  ".ppt",
  ".md",
  ".markdown",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".html",
  ".htm",
  ".txt",
  ".text",
  ".rtf",
  ".zip",
]);

function basenameOf(path: string): string {
  const normalized = path.replace(/[\\]+/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function fileExtension(path: string): string {
  const base = basenameOf(path).toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

export function isContentDeliverablePath(path: string): boolean {
  return CONTENT_DELIVERABLE_EXTENSIONS.has(fileExtension(path));
}

/** Last path segment of a session cwd (expert sessionKey or folder name). */
export function sessionDirectoryKey(sessionRoot: string): string {
  const parts = sessionRoot.replace(/[\\]+/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Expert catalog paths are `<agent>/<sessionKey>/<rel>`.
 * Artifact resolve uses the session cwd, so strip down to `<rel>`.
 */
export function sessionRelativeExpertInventoryPath(
  catalogPath: string,
  sessionKey: string,
): string | null {
  const key = sessionKey.trim();
  if (!key) return null;
  const parts = catalogPath.replace(/[\\]+/g, "/").split("/").filter(Boolean);
  const index = parts.indexOf(key);
  if (index < 0 || index >= parts.length - 1) return null;
  return parts.slice(index + 1).join("/");
}

function isFilenameGlueChar(ch: string): boolean {
  if (!ch) return false;
  return /[\p{L}\p{N}._\-【】「」『』（）／]/u.test(ch);
}

/** Exact basename in text; reject `report.docx` inside `final-report.docx`. */
export function assistantTextIncludesFilename(text: string, filename: string): boolean {
  const name = filename.trim();
  if (name.length < 3 || !name.includes(".")) return false;
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(name, from);
    if (index < 0) return false;
    const before = index > 0 ? text[index - 1] ?? "" : "";
    const after = text[index + name.length] ?? "";
    if (!isFilenameGlueChar(before) && !isFilenameGlueChar(after)) return true;
    from = index + 1;
  }
  return false;
}

export function lastAssistantTextFromMessages(
  messages: ReadonlyArray<{
    role?: string;
    parts?: ReadonlyArray<{ type?: string; text?: unknown }>;
  }>,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const texts: string[] = [];
    for (const part of message.parts ?? []) {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        texts.push(part.text);
      }
    }
    if (texts.length) return texts.join("\n");
  }
  return "";
}

/** Inventory paths whose exact basename appears in assistant text. */
export function matchInventoryPathsInText(
  inventoryPaths: readonly string[],
  text: string,
): string[] {
  if (!text.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of inventoryPaths) {
    const path = raw.replace(/[\\]+/g, "/").replace(/^\.\//, "");
    if (!path || !isContentDeliverablePath(path)) continue;
    if (isLikelyUserUploadArtifactPath(path)) continue;
    if (!assistantTextIncludesFilename(text, basenameOf(path))) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export function openTargetFromInventoryPath(path: string): OpenTarget | null {
  const normalized = path.replace(/[\\]+/g, "/").replace(/^\.\//, "").trim();
  if (!normalized || !normalized.includes(".")) return null;
  if (isLikelyUserUploadArtifactPath(normalized)) return null;
  if (!isContentDeliverablePath(normalized)) return null;
  return {
    id: `file:${normalized.toLowerCase()}`,
    kind: "file",
    value: normalized,
    name: basenameOf(normalized),
    preview: classifyOpenTarget(normalized, "file"),
    confidence: 88,
    reason: "session inventory",
  };
}

export function mintInventoryOpenTargets(
  inventoryPaths: readonly string[],
  lastAssistantText: string,
): OpenTarget[] {
  const targets: OpenTarget[] = [];
  for (const path of matchInventoryPathsInText(inventoryPaths, lastAssistantText)) {
    const target = openTargetFromInventoryPath(path);
    if (target) targets.push(target);
  }
  return targets;
}

export function mergeOpenTargetsWithInventory(
  openTargets: OpenTarget[],
  inventoryTargets: OpenTarget[],
): OpenTarget[] {
  const map = new Map(openTargets.map((target) => [target.id, target]));
  for (const target of inventoryTargets) {
    const existing = map.get(target.id);
    if (!existing || target.confidence > existing.confidence) {
      map.set(target.id, target);
    }
  }
  return Array.from(map.values());
}
