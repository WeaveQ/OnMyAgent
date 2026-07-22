/** @jsxImportSource react */
import type { UIMessage } from "ai";

export type OpenTargetKind = "url" | "file";
export type OpenTargetPreview =
  | "browser"
  | "markdown"
  | "document"
  | "sheet"
  | "presentation"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "html"
  | "text"
  | "external";

export interface TextData {
  kind: "text";
  data: string;
}

export interface BinaryData {
  kind: "binary";
  data: ArrayBuffer;
}

export type Data = TextData | BinaryData;

export type OpenTarget = {
  id: string;
  kind: OpenTargetKind;
  value: string;
  name: string;
  preview: OpenTargetPreview;
  confidence: number;
  reason: string;
  exists?: boolean;
  size?: number;
  updatedAt?: number;
};

const WORKSPACES_PREFIX_PATTERN = /^workspaces\/[^/]+\//i;
const WORKSPACE_ID_PREFIX_PATTERN = /^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i;

// Path segments allow Unicode letters/numbers (e.g. agents/应收台账模板.xlsx).
// \w alone is ASCII-only and dropped Chinese filenames from the files panel.
const FILE_PATH_SEGMENT = String.raw`[\p{L}\p{N}._\-]+`;
const FILE_PATTERN = new RegExp(
  String.raw`(?:^|[\s"'` +
    "`" +
    String.raw`([{])((?:\.{1,2}[/\\]|~[/\\]|[/\\])?(?:` +
    FILE_PATH_SEGMENT +
    String.raw`[/\\])+` +
    FILE_PATH_SEGMENT +
    String.raw`\.[a-z][a-z0-9]{0,9}|` +
    FILE_PATH_SEGMENT +
    String.raw`\.[a-z][a-z0-9]{0,9})`,
  "giu",
);
const URL_PATTERN = /https?:\/\/[^\s)\]}>"'`]+/gi;
const SOCKET_PATTERN = /(?:ws|wss):\/\/[^\s)\]}>"'`]+/gi;
const ARTIFACT_FILE_PREVIEWS = new Set<OpenTargetPreview>([
  "markdown",
  "document",
  "sheet",
  "presentation",
  "image",
  "audio",
  "video",
  "pdf",
  "html",
]);
const DISCOVERY_TOOL_NAMES = new Set(["glob", "grep", "search", "find"]);
const WRITE_TOOL_NAMES = new Set([
  "apply_patch",
  "bash",
  "edit",
  "edit_file",
  "execute",
  "multi_edit",
  "multiedit",
  "patch",
  "run_terminal_cmd",
  "shell",
  "str_replace_editor",
  "write",
  "write_file",
]);
const FILE_METADATA_KEYS = ["path", "file", "filePath", "filepath"];
const PATCH_FILE_PATTERN = /^\*\*\* (?:Add File|Update File):\s*(.+)$/gmi;
const PATCH_MOVE_TO_PATTERN = /^\*\*\* Move to:\s*(.+)$/gmi;

type DeriveOpenTargetsOptions = {
  includeFileMentions?: boolean;
};

function normalizePath(path: string) {
  return path
    .trim()
    .replace(/[\\]+/g, "/")
    .replace(/^\.\//, "")
    .replace(WORKSPACES_PREFIX_PATTERN, "")
    .replace(WORKSPACE_ID_PREFIX_PATTERN, "");
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * Resolve a workspace-relative or session-relative artifact path to an absolute
 * filesystem path for desktop reveal/open.
 *
 * Handles the expert isolation case where `workspaceRoot` may be either the
 * catalog workspace root or the per-session directory, while `value` may be
 * relative to either — avoiding double-joined paths like:
 *   /ws/agent/sid + agent/sid/output/x.pdf → /ws/agent/sid/agent/sid/output/x.pdf
 */
export function resolveArtifactAbsolutePath(
  value: string,
  workspaceRoot?: string | null,
): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (isAbsoluteFilesystemPath(raw)) return raw;

  const relative = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!relative) return null;

  const root = (workspaceRoot ?? "").trim().replace(/[/\\]+$/, "");
  if (!root) return relative;

  const rootPosix = root.replace(/\\/g, "/");
  const sep = root.includes("\\") ? "\\" : "/";
  const rootParts = rootPosix.split("/").filter(Boolean);
  const relParts = relative.split("/").filter(Boolean);

  for (let overlap = Math.min(rootParts.length, relParts.length); overlap > 0; overlap -= 1) {
    const rootSuffix = rootParts.slice(-overlap).join("/");
    const relPrefix = relParts.slice(0, overlap).join("/");
    if (rootSuffix.toLowerCase() === relPrefix.toLowerCase()) {
      const rest = relParts.slice(overlap);
      return rest.length ? `${root}${sep}${rest.join(sep)}` : root;
    }
  }

  return `${root}${sep}${relParts.join(sep)}`;
}

/** Prefer verified target path, then raw path; build absolute candidates for reveal. */
export function resolveArtifactRevealCandidates(
  pathOrValue: string,
  options: {
    workspaceRoot?: string | null;
    verifiedValue?: string | null;
  } = {},
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (candidate: string | null | undefined) => {
    const next = candidate?.trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    out.push(next);
  };

  const verified = options.verifiedValue?.trim();
  if (verified) {
    push(resolveArtifactAbsolutePath(verified, options.workspaceRoot));
    if (isAbsoluteFilesystemPath(verified)) push(verified);
  }

  push(resolveArtifactAbsolutePath(pathOrValue, options.workspaceRoot));
  if (isAbsoluteFilesystemPath(pathOrValue.trim())) push(pathOrValue.trim());

  return out;
}

function basename(value: string) {
  const clean = value.split(/[?#]/)[0] ?? value;
  return clean.split("/").filter(Boolean).pop() ?? value;
}

function extname(value: string) {
  const name = basename(value).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

export function classifyOpenTarget(value: string, kind: OpenTargetKind): OpenTargetPreview {
  if (kind === "url") return "browser";
  const ext = extname(value);
  if ([".md", ".markdown", ".mdx"].includes(ext)) return "markdown";
  if ([".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".rtf", ".odt"].includes(ext)) {
    return "document";
  }
  if ([".csv", ".tsv", ".xls", ".xlsx", ".xlsm", ".xlsb", ".xlt", ".xltx", ".xltm", ".ods", ".fods", ".numbers"].includes(ext)) {
    return "sheet";
  }
  if ([".ppt", ".pptx", ".pptm", ".ppsx", ".ppsm", ".potx", ".potm", ".odp"].includes(ext)) {
    return "presentation";
  }
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"].includes(ext)) return "image";
  if (ext === ".mp3") return "audio";
  if (ext === ".mp4") return "video";
  if ([".pdf", ".ofd"].includes(ext)) return "pdf";
  if ([".html", ".htm"].includes(ext)) return "html";
  // Source / config that the text pane can open safely (not Office binaries).
  if (
    [
      ".txt",
      ".log",
      ".json",
      ".jsonc",
      ".yaml",
      ".yml",
      ".toml",
      ".xml",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".css",
      ".scss",
      ".less",
      ".py",
      ".rs",
      ".go",
      ".java",
      ".kt",
      ".swift",
      ".rb",
      ".php",
      ".c",
      ".h",
      ".cpp",
      ".hpp",
      ".cs",
      ".sh",
      ".bash",
      ".zsh",
      ".sql",
      ".r",
      ".env",
      ".ini",
      ".cfg",
      ".conf",
      ".vue",
      ".svelte",
      ".graphql",
      ".gql",
    ].includes(ext)
  ) {
    return "text";
  }
  return "external";
}

/**
 * Whether the files / side-panel surface can render this target inline
 * through the existing text/browser paths or the local Office/PDF renderer.
 */
export function canPreviewOpenTargetInline(target: OpenTarget): boolean {
  if (target.kind === "url" || target.preview === "browser") return true;
  if (target.preview === "markdown" || target.preview === "text") return true;
  if (target.preview === "html") return true;
  if (["image", "audio", "video"].includes(target.preview)) return true;
  if (["document", "sheet", "presentation", "pdf"].includes(target.preview)) return true;
  return false;
}

function targetFromFile(path: string, confidence: number, reason: string): OpenTarget | null {
  const normalized = normalizePath(path).replace(/[.,;:]+$/, "");
  if (!normalized || normalized.length > 500 || !normalized.includes(".")) return null;
  return {
    id: `file:${normalized.toLowerCase()}`,
    kind: "file",
    value: normalized,
    name: basename(normalized),
    preview: classifyOpenTarget(normalized, "file"),
    confidence,
    reason,
  };
}

function targetFromUrl(url: string, confidence: number, reason: string): OpenTarget | null {
  const stripped = url.trim().replace(/[.,;:`\\]+$/, "");
  let clean = stripped;
  try {
    const parsed = new URL(stripped);
    if (/^\/+$/i.test(parsed.pathname) && !parsed.search && !parsed.hash) {
      clean = parsed.origin;
    }
  } catch {
    // Keep the stripped value; regex extraction already validated the shape.
  }
  if (!clean) return null;
  return {
    id: `url:${clean}`,
    kind: "url",
    value: clean,
    name: basename(clean) || clean,
    preview: "browser",
    confidence,
    reason,
  };
}

function addTarget(map: Map<string, OpenTarget>, target: OpenTarget | null) {
  if (!target) return;
  const existing = map.get(target.id);
  if (!existing || target.confidence >= existing.confidence) map.set(target.id, target);
}

function isArtifactTarget(target: OpenTarget) {
  return target.kind === "url" || ARTIFACT_FILE_PREVIEWS.has(target.preview);
}

export function isCollectibleArtifactTarget(target: OpenTarget) {
  return target.kind === "file" && target.exists === true && ARTIFACT_FILE_PREVIEWS.has(target.preview);
}

export function isLocalhostBrowserTarget(target: OpenTarget) {
  return target.kind === "url" && /(?:https?|wss?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(target.value);
}

export function selectAutoOpenTarget(targets: OpenTarget[]): OpenTarget | null {
  return targets.find(shouldAutoOpenTarget) ?? null;
}

function scanText(
  map: Map<string, OpenTarget>,
  text: string,
  confidence: number,
  reason: string,
  options: { includeFiles: boolean },
) {
  if (!text) {
    return;
  }

  URL_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    if (match[0]) addTarget(map, targetFromUrl(match[0], confidence, reason));
  }

  SOCKET_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(SOCKET_PATTERN)) {
    if (match[0]) addTarget(map, targetFromUrl(match[0], confidence, reason));
  }

  if (!options.includeFiles) return;

  FILE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(FILE_PATTERN)) {
    if (match[1]) addTarget(map, targetFromFile(match[1], confidence, reason));
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizedToolName(toolName: string) {
  return toolName.trim().toLowerCase().replace(/^functions[._-]/, "");
}

function isDiscoveryTool(toolName: string) {
  return DISCOVERY_TOOL_NAMES.has(normalizedToolName(toolName));
}

function isWriteTool(toolName: string) {
  return WRITE_TOOL_NAMES.has(normalizedToolName(toolName));
}

function collectFileMetadataValues(value: unknown) {
  if (!isObject(value)) return [];
  const values: string[] = [];
  for (const key of FILE_METADATA_KEYS) {
    const file = value[key];
    if (typeof file === "string") values.push(file);
  }
  const files = value.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      if (typeof file === "string") values.push(file);
    }
  }
  return values;
}

function collectPatchFileValues(value: unknown) {
  if (!isObject(value)) return [];
  const patchText = value.patchText ?? value.patch ?? value.diff;
  if (typeof patchText !== "string") return [];
  const values: string[] = [];
  PATCH_FILE_PATTERN.lastIndex = 0;
  for (const match of patchText.matchAll(PATCH_FILE_PATTERN)) {
    if (match[1]) values.push(match[1]);
  }
  PATCH_MOVE_TO_PATTERN.lastIndex = 0;
  for (const match of patchText.matchAll(PATCH_MOVE_TO_PATTERN)) {
    if (match[1]) values.push(match[1]);
  }
  return values;
}

function addFileValues(map: Map<string, OpenTarget>, values: string[], confidence: number, reason: string) {
  for (const value of values) {
    addTarget(map, targetFromFile(value, confidence, reason));
  }
}

export function deriveOpenTargets(messages: UIMessage[], options: DeriveOpenTargetsOptions = {}): OpenTarget[] {
  const targets = new Map<string, OpenTarget>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        scanText(targets, part.text, message.role === "assistant" ? 65 : 40, "message", {
          includeFiles: options.includeFileMentions === true,
        });
        continue;
      }

      if (part.type !== "dynamic-tool") {
        continue;
      }

      const discoveryTool = isDiscoveryTool(part.toolName);
      const writeTool = isWriteTool(part.toolName);

      if (writeTool) {
        addFileValues(
          targets,
          [part.input, part.output].flatMap(collectFileMetadataValues),
          95,
          "write tool metadata",
        );
        addFileValues(targets, collectPatchFileValues(part.input), 95, "patch metadata");
        if (typeof part.output === "string") {
          scanText(targets, part.output, 90, "write tool output", { includeFiles: true });
        }
      }

      if (!discoveryTool) {
        scanText(targets, JSON.stringify(part.output ?? part.input ?? ""), 75, "tool output", { includeFiles: false });
      }
    }
  }

  return Array.from(targets.values())
    .filter(isArtifactTarget)
    .sort((left, right) => right.confidence - left.confidence);
}

export function shouldAutoOpenTarget(): boolean {
  return false;
}
