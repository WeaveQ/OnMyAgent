import type { UIMessage } from "ai";
import {
  deriveOpenTargets,
  extractDeclaredDeliverablePaths,
  isCollectibleArtifactTarget,
  isLikelyUserUploadArtifactPath,
  isUserFacingLocalPreviewTarget,
  type OpenTarget,
} from "../../artifacts/open-target";

function basenameOf(path: string) {
  const normalized = path.replace(/[\\]+/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function normalizePathKey(path: string) {
  return path.replace(/[\\]+/g, "/").replace(/^\.\//, "");
}

function fileExtension(path: string): string {
  const base = basenameOf(path).toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

/** Common end-user deliverables (always show when written/declared). */
const CONTENT_DELIVERABLE_EXTENSIONS = new Set([
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
  ".json",
  ".zip",
]);

/** May be the final product (user asked for a script) OR a throwaway helper. */
const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".mjs",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".rb",
  ".pl",
  ".ps1",
  ".cmd",
  ".bat",
  ".go",
  ".rs",
  ".java",
]);

/**
 * Heuristic: scripts written only to generate another deliverable.
 * e.g. extract_sheets.cjs, gen_xlsx.py, /tmp/helper.cjs
 */
function isProcessHelperScript(path: string): boolean {
  const normalized = normalizePathKey(path);
  const base = basenameOf(normalized).toLowerCase();
  const ext = fileExtension(normalized);
  if (!CODE_EXTENSIONS.has(ext)) return false;

  if (
    /(^|\/)(\.opencode\/tmp|tmp|temp|temps)(\/|$)/i.test(normalized)
    || normalized.startsWith("/tmp/")
    || normalized.startsWith("/var/folders/")
  ) {
    return true;
  }

  const stem = base.slice(0, base.length - ext.length);
  // extract_sheets, gen_xlsx, tmp_run, helper_foo, scratch_…
  if (
    /^(extract|gen|generate|tmp|temp|scratch|helper|util|run|build|convert)[-_.]/i.test(
      stem,
    )
  ) {
    return true;
  }
  if (/[-_](tmp|temp|scratch|helper|util)$/i.test(stem)) return true;
  return false;
}

function isContentDeliverable(path: string): boolean {
  return CONTENT_DELIVERABLE_EXTENSIONS.has(fileExtension(path));
}

function isCodePath(path: string): boolean {
  return CODE_EXTENSIONS.has(fileExtension(path));
}

/** Basenames from user message file parts (composer attachments). */
function userAttachmentBasenames(messages: UIMessage[]): Set<string> {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      if (part.type !== "file") continue;
      const filename =
        typeof part.filename === "string" && part.filename.trim()
          ? part.filename.trim()
          : "";
      if (filename) names.add(basenameOf(filename).toLowerCase());
    }
  }
  return names;
}

function matchesUserAttachment(path: string, userBasenames: Set<string>): boolean {
  if (userBasenames.size === 0) return false;
  const base = basenameOf(path).toLowerCase();
  if (userBasenames.has(base)) return true;
  for (const name of userBasenames) {
    if (base.endsWith(name) || base.includes(`-${name}`)) return true;
  }
  return false;
}

function isBlockedUserPath(path: string, userBasenames: Set<string>): boolean {
  return (
    isLikelyUserUploadArtifactPath(path) || matchesUserAttachment(path, userBasenames)
  );
}

function findVerifiedFile(
  path: string,
  verifiedById: Map<string, OpenTarget>,
  verifiedFiles: OpenTarget[],
): OpenTarget | undefined {
  const normalizedCandidate = normalizePathKey(path);
  const byId = verifiedById.get(`file:${normalizedCandidate}`)
    ?? verifiedById.get(`file:${path}`);
  if (byId) return byId;
  return verifiedFiles.find((target) => {
    const normalizedTarget = normalizePathKey(target.value);
    return (
      normalizedTarget === normalizedCandidate
      || normalizedTarget.endsWith(`/${normalizedCandidate}`)
      || normalizedCandidate.endsWith(`/${normalizedTarget}`)
      || basenameOf(normalizedTarget).toLowerCase()
        === basenameOf(normalizedCandidate).toLowerCase()
    );
  });
}

function assistantTextBlob(messages: UIMessage[]): string {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" && typeof part.text === "string" ? [part.text] : [],
      ),
    )
    .join("\n");
}

/**
 * Scripts that were written and then executed in the same turn are almost
 * always process helpers (node extract_sheets.cjs), not the user-facing product.
 */
function scriptsExecutedInTurn(messages: UIMessage[]): Set<string> {
  const executed = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "dynamic-tool") continue;
      const name = String(part.toolName ?? "").toLowerCase();
      if (!/bash|shell|execute|run_terminal|cmd/.test(name)) continue;
      const input = part.input;
      const command =
        typeof input === "object" && input && typeof (input as { command?: string }).command === "string"
          ? (input as { command: string }).command
          : typeof input === "string"
            ? input
            : "";
      if (!command) continue;
      // node foo.cjs / python bar.py / ./script.sh
      const match = command.match(
        /(?:^|[\s;&|])(?:node|nodejs|python3?|bash|sh|tsx?|deno)\s+["']?([^\s"'\\]+\.(?:cjs|mjs|js|ts|tsx|py|sh))/i,
      );
      if (match?.[1]) {
        executed.add(basenameOf(match[1]).toLowerCase());
      }
    }
  }
  return executed;
}

function pathMatchesDeclared(path: string, declared: string[]): boolean {
  const base = basenameOf(path).toLowerCase();
  const key = normalizePathKey(path).toLowerCase();
  return declared.some((item) => {
    const dBase = basenameOf(item).toLowerCase();
    const dKey = normalizePathKey(item).toLowerCase();
    return (
      dBase === base
      || dKey === key
      || key.endsWith(`/${dKey}`)
      || dKey.endsWith(`/${key}`)
    );
  });
}

/**
 * Whether this path should appear on the turn product strip.
 * - Content files (xlsx/png/html/txt…): yes (if verified)
 * - Process helpers (extract_*.cjs, tmp scripts, scripts run in-turn): no
 * - Intentional code deliverables (.js/.py declared as 文件路径): yes
 */
export function shouldShowAsTurnDeliverable(
  path: string,
  context: {
    declaredPaths: string[];
    executedScriptBasenames: Set<string>;
    hasContentDeliverableInTurn: boolean;
  },
): boolean {
  if (isProcessHelperScript(path)) return false;
  if (context.executedScriptBasenames.has(basenameOf(path).toLowerCase())) {
    // Ran in this turn → treat as process helper unless it is also the only
    // declared deliverable and no content files exist.
    if (context.hasContentDeliverableInTurn) return false;
    if (!pathMatchesDeclared(path, context.declaredPaths)) return false;
  }
  if (isContentDeliverable(path)) return true;
  if (isCodePath(path)) {
    // .js/.py products: only when assistant explicitly declares them.
    return pathMatchesDeclared(path, context.declaredPaths);
  }
  // Unknown extension: only if explicitly declared as deliverable.
  return pathMatchesDeclared(path, context.declaredPaths);
}

export function selectTurnOpenTargets(
  messages: UIMessage[],
  verifiedTargets: OpenTarget[] | undefined,
) {
  const verifiedById = new Map((verifiedTargets ?? []).map((target) => [target.id, target] as const));
  const verifiedFiles = (verifiedTargets ?? []).filter(
    (target) => target.kind === "file" && target.exists === true,
  );
  const userBasenames = userAttachmentBasenames(messages);
  const inlineTargets = new Map<string, OpenTarget>();
  const assistantBlob = assistantTextBlob(messages);
  const declaredPaths = extractDeclaredDeliverablePaths(assistantBlob);
  const executedScriptBasenames = scriptsExecutedInTurn(messages);

  const candidatePaths: string[] = [];
  for (const candidate of deriveOpenTargets(messages, { includeFileMentions: false })) {
    if (candidate.kind === "file") candidatePaths.push(candidate.value);
  }
  for (const declared of declaredPaths) candidatePaths.push(declared);

  const hasContentDeliverableInTurn = candidatePaths.some(
    (path) =>
      isContentDeliverable(path)
      && !isBlockedUserPath(path, userBasenames)
      && !isProcessHelperScript(path),
  );

  const showContext = {
    declaredPaths,
    executedScriptBasenames,
    hasContentDeliverableInTurn,
  };

  const addVerifiedFile = (candidatePath: string, candidate?: OpenTarget) => {
    if (isBlockedUserPath(candidatePath, userBasenames)) return;
    if (!shouldShowAsTurnDeliverable(candidatePath, showContext)) return;
    const verified = findVerifiedFile(candidatePath, verifiedById, verifiedFiles)
      ?? (candidate && isCollectibleArtifactTarget({ ...candidate, exists: true })
        ? { ...candidate, exists: true as const }
        : undefined);
    if (!verified || !isCollectibleArtifactTarget(verified)) return;
    if (isBlockedUserPath(verified.value, userBasenames)) return;
    if (!shouldShowAsTurnDeliverable(verified.value, showContext)) return;
    inlineTargets.set(verified.id, verified);
  };

  for (const candidate of deriveOpenTargets(messages, { includeFileMentions: false })) {
    if (candidate.kind === "url" && isUserFacingLocalPreviewTarget(candidate)) {
      inlineTargets.set(candidate.id, candidate);
      continue;
    }
    if (candidate.kind === "file") {
      addVerifiedFile(candidate.value, candidate);
    }
  }

  for (const declared of declaredPaths) {
    addVerifiedFile(declared);
  }

  return Array.from(inlineTargets.values()).slice(0, 4);
}
