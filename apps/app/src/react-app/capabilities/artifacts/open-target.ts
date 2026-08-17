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
  "text",
]);
const DISCOVERY_TOOL_NAMES = new Set(["glob", "grep", "search", "find"]);
/**
 * Tools that intentionally create/edit files. Their path metadata (and patch
 * bodies) are treatable as deliverable provenance.
 *
 * IMPORTANT: do NOT put bash/shell/execute here. Agents often *read* user
 * uploads via shell (inspect/find/node script input). Treating every path in
 * shell stdout as a "write" made session-upload files show as product cards.
 */
const WRITE_TOOL_NAMES = new Set([
  "apply_patch",
  "edit",
  "edit_file",
  "multi_edit",
  "multiedit",
  "patch",
  "str_replace_editor",
  "write",
  "write_file",
]);
/** Shell tools may create files via scripts; only scan stdout when write-like. */
const SHELL_TOOL_NAMES = new Set([
  "bash",
  "execute",
  "run_terminal_cmd",
  "shell",
]);
const FILE_METADATA_KEYS = ["path", "file", "filePath", "filepath"];
const PATCH_FILE_PATTERN = /^\*\*\* (?:Add File|Update File):\s*(.+)$/gmi;
const PATCH_MOVE_TO_PATTERN = /^\*\*\* Move to:\s*(.+)$/gmi;
/** Session inbox uploads: `{timestampMs}-{index}-{originalName}`. */
const INBOX_UPLOAD_BASENAME_PATTERN = /^\d{10,}-\d+-.+/;

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

/**
 * User-facing local previews (e.g. `http://localhost:5173`) — not internal
 * loopback bridges (`http://127.0.0.1:9823` browser/runtime ports) that leak
 * from tool JSON and look like bogus "open browser" chips in the transcript.
 */
export function isUserFacingLocalPreviewTarget(target: OpenTarget): boolean {
  if (!isLocalhostBrowserTarget(target)) return false;
  try {
    const url = new URL(target.value);
    const host = url.hostname.toLowerCase();
    // Agents write `localhost:port` for app previews. Bare 127.0.0.1 / ::1 /
    // 0.0.0.0 origins are almost always OnMyAgent internal services.
    if (host !== "localhost") return false;
    return true;
  } catch {
    return false;
  }
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

function isShellTool(toolName: string) {
  return SHELL_TOOL_NAMES.has(normalizedToolName(toolName));
}

function shellCommandText(input: unknown): string {
  if (typeof input === "string") return input;
  if (!isObject(input)) return "";
  for (const key of ["command", "cmd", "script", "code"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function shellOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output == null) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return "";
  }
}

/** Machine marker printed by artifact-runtime after a successful write. */
const RUNTIME_DELIVERABLE_MARKER =
  /(?:^|\n)[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?ONMYAGENT_DELIVERABLE:[ \t]*(.+?)[ \t]*(?:\*\*|__)?[ \t]*(?=\n|$)/g;

function shellWorkingDirectory(command: string): string | undefined {
  const match = command.match(
    /^\s*cd(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;&]+))\s*&&/i,
  );
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim() || undefined;
}

function resolveRuntimePath(path: string, workingDirectory: string | undefined): string {
  if (!workingDirectory || !path || path.startsWith("/") || /^[a-z]:[\\/]/i.test(path)) {
    return path;
  }
  const separator = workingDirectory.includes("\\") ? "\\" : "/";
  return `${workingDirectory.replace(/[\\/]+$/, "")}${separator}${path.replace(/^\.\//, "")}`;
}

/** OfficeCLI verbs that create or flush document files (managed launcher also emits markers). */
const OFFICECLI_MUTATING_VERB =
  /\b(create|save|close|set|add|remove|move|swap|batch|raw-set|add-part|refresh|merge)\b/i;

/**
 * Paths registered by first-class artifact-runtime writes:
 * - `ONMYAGENT_DELIVERABLE: path` lines
 * - JSON payloads with `deliverable: true` + `wrote[]` / `path`
 * - `write-xlsx` / `extract-sheets --out <file>` command args
 * - OfficeCLI mutating commands (create/save/set/…)
 */
export function collectRuntimeRegisteredDeliverablePaths(
  input: unknown,
  output: unknown,
): string[] {
  const command = shellCommandText(input);
  const out = shellOutputText(output);
  const paths: string[] = [];
  const workingDirectory = shellWorkingDirectory(command);

  RUNTIME_DELIVERABLE_MARKER.lastIndex = 0;
  for (const match of out.matchAll(RUNTIME_DELIVERABLE_MARKER)) {
    const raw = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
    if (raw) paths.push(resolveRuntimePath(raw, workingDirectory));
  }

  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isObject(parsed)) continue;
      const isDeliverable =
        parsed.deliverable === true
        || (
          parsed.status === "success"
          && (
            Array.isArray(parsed.wrote)
            || (typeof parsed.path === "string" && /\b(write-xlsx|extract-sheets)\b/i.test(command))
          )
        );
      if (!isDeliverable) continue;
      if (Array.isArray(parsed.wrote)) {
        for (const item of parsed.wrote) {
          if (typeof item === "string" && item.trim()) paths.push(item.trim());
        }
      }
      if (typeof parsed.path === "string" && parsed.path.trim()) {
        paths.push(parsed.path.trim());
      }
      if (Array.isArray(parsed.outputs)) {
        for (const item of parsed.outputs) {
          if (isObject(item) && typeof item.path === "string" && item.path.trim()) {
            paths.push(item.path.trim());
          }
        }
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  // Fallback: first-class write commands always declare --out <file>.
  // Do not treat --out-dir as a file deliverable.
  if (/\b(write-xlsx|extract-sheets)\b/i.test(command)) {
    const outFile = command.match(/(?:^|[\s])--out(?:\s+|=)(?!-dir)(["']?)([^"'\s]+)\1/i);
    if (outFile?.[2]) paths.push(outFile[2]);
  }

  // OfficeCLI: file path is the first positional after a mutating verb.
  // merge <template> <output> → register the output (2nd positional), not the template.
  // Launcher also prints ONMYAGENT_DELIVERABLE; keep command-arg fallback for
  // older launchers and bare binary invocations.
  if (/\bofficecli(?:\.cmd|\.exe)?\b/i.test(command) && OFFICECLI_MUTATING_VERB.test(command)) {
    const mergeMatch = command.match(
      /\bofficecli(?:\.cmd|\.exe)?\b[\s\S]*?\bmerge\b\s+(["']?)([^"'\s]+)\1\s+(["']?)([^"'\s]+)\3/i,
    );
    if (mergeMatch?.[4] && /\.(docx|xlsx|pptx)$/i.test(mergeMatch[4])) {
      paths.push(mergeMatch[4]);
    } else {
      const officeFile = command.match(
        /\bofficecli(?:\.cmd|\.exe)?\b[\s\S]*?\b(?:create|save|close|set|add|remove|move|swap|batch|raw-set|add-part|refresh)\b\s+(["']?)([^"'\s]+)\1/i,
      );
      if (officeFile?.[2] && /\.(docx|xlsx|pptx)$/i.test(officeFile[2])) {
        paths.push(officeFile[2]);
      }
    }
    for (const match of out.matchAll(/(?:^|\n)Created:\s*(.+?)(?:\s*\(|\s*$)/gim)) {
      const raw = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
      if (raw && /\.(docx|xlsx|pptx)$/i.test(raw)) paths.push(raw);
    }
    // merge --json: { success, data: { output: "…/out.docx" } }
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!isObject(parsed) || parsed.success === false) continue;
        const data = parsed.data;
        if (isObject(data) && typeof data.output === "string") {
          const outPath = data.output.trim();
          if (outPath && /\.(docx|xlsx|pptx)$/i.test(outPath)) paths.push(outPath);
        }
      } catch {
        // ignore
      }
    }
  }

  const seen = new Set<string>();
  return paths.filter((value) => {
    if (!value || seen.has(value)) return false;
    if (isLikelyUserUploadArtifactPath(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * Whether a shell invocation looks like it *created* files (node/python write
 * scripts or first-class artifact-runtime write commands), not merely
 * inspected or listed paths (find/ls/inspect/read).
 */
function shellToolLooksLikeFileWrite(input: unknown, output: unknown): boolean {
  const command = shellCommandText(input);
  const out = shellOutputText(output);
  // Runtime-registered deliverables always mint product cards.
  if (/ONMYAGENT_DELIVERABLE:/i.test(out)) {
    return true;
  }
  // First-class spreadsheet runtime write commands always mint deliverables.
  if (/\b(extract-sheets|write-xlsx)\b/i.test(command)) {
    return true;
  }
  // Managed OfficeCLI mutating verbs create/update Office documents.
  if (
    /\bofficecli(?:\.cmd|\.exe)?\b/i.test(command)
    && OFFICECLI_MUTATING_VERB.test(command)
  ) {
    return true;
  }
  // Pure discovery / read-style commands never mint deliverable cards.
  // Match artifact_runtime subcommands carefully: `read`/`inspect`/`verify`
  // are readers; do not treat them as writes even if paths appear in JSON.
  if (
    /\b(find|ls|glob|rg|grep|cat|head|tail|stat|mdfind)\b/i.test(command)
    || /artifact_runtime\.cjs\s+(inspect|doctor|verify|read|capabilities)\b/i.test(command)
    || (
      /\b(inspect|doctor|verify)\b/i.test(command)
      && !/\b(writeFile|write_file|XLSX\.write|exceljs|\.write\(|toFile|fs\.write|extract-sheets|write-xlsx|>>?|tee)\b/i.test(
        command,
      )
    )
  ) {
    return false;
  }
  // Bare `read` as shell command (not extract-sheets) — keep as non-write when
  // it is clearly a reader and not a write API.
  if (
    /(?:^|[\s;&|])(?:cat|head|tail|less|more)\b/i.test(command)
    && !/\b(writeFile|write_file|XLSX\.write|exceljs|extract-sheets|write-xlsx)\b/i.test(command)
  ) {
    return false;
  }
  const blob = `${command}\n${out}`;
  return (
    /\b(writeFile|write_file|XLSX\.write|workbook\.xlsx|exceljs|toFile|fs\.write|saveAs|saveas)\b/i.test(
      blob,
    )
    || /\b(Wrote|Saved|Created|written to|输出到|已写入|已生成|保存为)\b/i.test(out)
  );
}

/** True for paths that look like session user-upload inbox copies, not agent deliverables. */
export function isLikelyUserUploadArtifactPath(value: string): boolean {
  const normalized = normalizePath(value);
  if (!normalized) return false;
  if (/(^|\/)\.opencode\/onmyagent\/inbox(\/|$)/i.test(normalized)) return true;
  if (
    /(^|\/)(?:session-uploads|inbox)\//i.test(normalized)
    && INBOX_UPLOAD_BASENAME_PATTERN.test(basename(normalized))
  ) {
    return true;
  }
  return INBOX_UPLOAD_BASENAME_PATTERN.test(basename(normalized));
}

function collectDeclaredPathsFromPatterns(text: string, patterns: RegExp[]): string[] {
  if (!text.trim()) return [];
  const paths: string[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? "")
        .trim()
        // "发货需求.xlsx（工作目录根下）"
        .replace(/[（(].*$/u, "")
        .replace(/[，。；;）)\s]+$/gu, "");
      if (!raw || !/\.[a-z][a-z0-9]{0,9}$/i.test(raw)) continue;
      if (isLikelyUserUploadArtifactPath(raw)) continue;
      paths.push(raw);
    }
  }
  return paths;
}

const HARD_DECLARED_PATH_PATTERNS = [
  /文件路径\s*[:：]\s*[`「"'“]?([^\s`」"'”]+)[`」"'”]?/gi,
];

const SOFT_DECLARED_PATH_PATTERNS = [
  /(?:已生成|生成了|已写出|已保存|保存为|保存在|均保存在|已拆出|输出为|交付文件|输出文件)\s*(?:[:：]\s*)?[`「"'“]?([^\s`」"'”]+?\.[a-z][a-z0-9]{0,9})[`」"'”]?/gi,
  /(?:Created|Wrote|Saved)\s+[`"'“]?([^\s`"'”]+?\.[a-z][a-z0-9]{0,9})[`"'”]?/gi,
];

const EXPLICIT_ARTIFACT_LINK_PATTERNS = [
  /\]\((?:artifact|preview):\/?([^\s)]+)\)/gi,
];

const ASSISTANT_DELIVERY_CONTEXT_PATTERN =
  /(?:交付物|交付清单|交付如下|最终产物|产物清单|输出文件|deliverables?|ONMYAGENT_DELIVERABLE|已拆出|均保存在|保存在|独立(?:Excel|表格|工作簿|文件))/iu;
const ASSISTANT_DELIVERY_CODE_FILE_PATTERN =
  /`([^`\r\n]+?\.[a-z][a-z0-9]{0,9})`/giu;
const ASSISTANT_DELIVERY_LINK_LABEL_PATTERN =
  /\[([^\]\r\n]+?\.[a-z][a-z0-9]{0,9})\]\([^\r\n)]+\)/giu;
const ASSISTANT_DELIVERY_DIRECTORY_PATTERN = /`([^`\r\n]+[/\\])`/gu;
const ASSISTANT_DELIVERY_LIST_FILE_PATTERN =
  /^(?:[-*•]|\d+[.)])\s+[`「"'“]?([^\s`」"'”]+?\.[a-z][a-z0-9]{0,9})[`」"'”]?\s*$/gmu;

/**
 * File paths intentionally listed in the assistant's final delivery summary.
 *
 * Batch agents often create several files inside one shell/python operation,
 * then report them in a Markdown table and finish with a single sentence such
 * as "以上均为 ONMYAGENT_DELIVERABLE". Those files have real write provenance
 * on disk, but no per-file runtime marker. Treat code spans/link labels as a
 * delivery manifest only when the same assistant text has strong delivery
 * context; the server must still verify every candidate before a card appears.
 */
export function extractAssistantDeliveryManifestPaths(text: string): string[] {
  if (!ASSISTANT_DELIVERY_CONTEXT_PATTERN.test(text)) return [];

  const paths: string[] = [];
  RUNTIME_DELIVERABLE_MARKER.lastIndex = 0;
  for (const match of text.matchAll(RUNTIME_DELIVERABLE_MARKER)) {
    const raw = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
    if (raw && !isLikelyUserUploadArtifactPath(raw)) paths.push(raw);
  }
  let activeTableDirectory = "";
  for (const line of text.split(/\r?\n/u)) {
    ASSISTANT_DELIVERY_DIRECTORY_PATTERN.lastIndex = 0;
    const directory = ASSISTANT_DELIVERY_DIRECTORY_PATTERN.exec(line)?.[1]?.trim();
    if (directory) activeTableDirectory = directory.replace(/[\\]+/g, "/");

    for (const pattern of [
      ASSISTANT_DELIVERY_CODE_FILE_PATTERN,
      ASSISTANT_DELIVERY_LINK_LABEL_PATTERN,
      ASSISTANT_DELIVERY_LIST_FILE_PATTERN,
    ]) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        const raw = (match[1] ?? "").trim();
        if (!raw || isLikelyUserUploadArtifactPath(raw)) continue;
        const path = line.trimStart().startsWith("|")
          && activeTableDirectory
          && !raw.includes("/")
          && !raw.includes("\\")
          ? `${activeTableDirectory}${raw}`
          : raw;
        paths.push(path);
      }
    }
  }

  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = normalizePath(path).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Hard deliverable declarations (`文件路径: …`). These may mint product cards
 * even without a write-tool entry in the same turn.
 */
export function extractHardDeclaredDeliverablePaths(text: string): string[] {
  return collectDeclaredPathsFromPatterns(text, HARD_DECLARED_PATH_PATTERNS);
}

/**
 * Paths the assistant presents as deliverables in prose (hard + soft).
 * Soft forms (`已生成 foo.xlsx`) help intentional-code matching but alone do
 * not mint cards without write provenance.
 */
export function extractDeclaredDeliverablePaths(text: string): string[] {
  return collectDeclaredPathsFromPatterns(text, [
    ...HARD_DECLARED_PATH_PATTERNS,
    ...SOFT_DECLARED_PATH_PATTERNS,
  ]);
}

/** Explicit markdown artifact/preview links are intentional card provenance. */
export function extractExplicitArtifactLinkPaths(text: string): string[] {
  return collectDeclaredPathsFromPatterns(text, EXPLICIT_ARTIFACT_LINK_PATTERNS).map((path) => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  });
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
        if (message.role === "assistant") {
          addFileValues(
            targets,
            extractAssistantDeliveryManifestPaths(part.text),
            92,
            "assistant delivery manifest",
          );
        }
        continue;
      }

      if (part.type !== "dynamic-tool") {
        continue;
      }

      const discoveryTool = isDiscoveryTool(part.toolName);
      const writeTool = isWriteTool(part.toolName);
      const shellTool = isShellTool(part.toolName);

      if (writeTool) {
        // Real editors: path metadata + free-text paths in output are deliverables.
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
      } else if (shellTool) {
        // Shell: only mint file cards when the command/output indicates a write.
        // Inspect/find/read of user uploads must NOT become product cards.
        if (shellToolLooksLikeFileWrite(part.input, part.output)) {
          addFileValues(
            targets,
            collectRuntimeRegisteredDeliverablePaths(part.input, part.output),
            98,
            "runtime deliverable",
          );
          addFileValues(
            targets,
            [part.input, part.output].flatMap(collectFileMetadataValues),
            90,
            "shell write metadata",
          );
          const outText = shellOutputText(part.output);
          if (outText) {
            scanText(targets, outText, 90, "shell write output", {
              includeFiles: true,
            });
          }
        } else if (typeof part.output === "string") {
          scanText(targets, part.output, 70, "shell output", { includeFiles: false });
        }
      }

      if (!discoveryTool && !writeTool && !shellTool) {
        scanText(targets, JSON.stringify(part.output ?? part.input ?? ""), 75, "tool output", { includeFiles: false });
      }
    }
  }

  return Array.from(targets.values())
    .filter(isArtifactTarget)
    .filter((target) => target.kind !== "file" || !isLikelyUserUploadArtifactPath(target.value))
    .sort((left, right) => right.confidence - left.confidence);
}

export function shouldAutoOpenTarget(): boolean {
  return false;
}
