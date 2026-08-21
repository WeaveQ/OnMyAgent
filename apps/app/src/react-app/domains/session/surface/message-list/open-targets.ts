import type { UIMessage } from "ai";
import {
  deriveOpenTargets,
  extractAssistantDeliveryManifestPaths,
  extractDeclaredDeliverablePaths,
  extractExplicitArtifactLinkPaths,
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

function isSameDeliverableFile(left: OpenTarget, right: OpenTarget): boolean {
  if (left.kind !== "file" || right.kind !== "file") return false;
  const a = normalizePathKey(left.value).toLowerCase();
  const b = normalizePathKey(right.value).toLowerCase();
  if (a === b) return true;
  const aBase = basenameOf(a).toLowerCase();
  const bBase = basenameOf(b).toLowerCase();
  if (aBase !== bBase) return false;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`) || a === aBase || b === bBase;
}

function preferDeliverableFile(left: OpenTarget, right: OpenTarget): OpenTarget {
  const leftExists = left.exists === true;
  const rightExists = right.exists === true;
  if (leftExists !== rightExists) return rightExists ? right : left;
  const leftConfidence = left.confidence ?? 0;
  const rightConfidence = right.confidence ?? 0;
  if (rightConfidence !== leftConfidence) {
    return rightConfidence > leftConfidence ? right : left;
  }
  return normalizePathKey(right.value).length < normalizePathKey(left.value).length
    ? right
    : left;
}

/** Collapse relative + absolute mentions of the same space-folder file. */
export function collapseDuplicateFileTargets(targets: OpenTarget[]): OpenTarget[] {
  const kept: OpenTarget[] = [];
  for (const target of targets) {
    if (target.kind === "url") {
      if (!kept.some((existing) => existing.id === target.id)) kept.push(target);
      continue;
    }
    const index = kept.findIndex((existing) => isSameDeliverableFile(existing, target));
    if (index < 0) {
      kept.push(target);
      continue;
    }
    kept[index] = preferDeliverableFile(kept[index]!, target);
  }
  return kept;
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

/** Hidden, system, and temporary paths are execution plumbing, never cards. */
function isProcessArtifactPath(path: string): boolean {
  const normalized = normalizePathKey(path);
  if (!normalized) return true;
  // Location SoT: tmp / .opencode/tmp / OS temp / cache — not business names.
  if (
    /(^|\/)(?:\.opencode\/tmp|tmp|temp|temps|cache|node_modules)(\/|$)/i.test(normalized)
    || /^(?:\/|[a-z]:\/)(?:tmp|var\/folders|private|system|library|usr)(?:\/|$)/i.test(normalized)
  ) {
    return true;
  }
  return normalized.split("/").some(
    (segment) => segment.startsWith(".") && segment !== ".onmyagent",
  );
}

function findVerifiedFile(
  path: string,
  verifiedById: Map<string, OpenTarget>,
  verifiedFiles: OpenTarget[],
): OpenTarget | undefined {
  const normalizedCandidate = normalizePathKey(path);
  const byId = verifiedById.get(`file:${normalizedCandidate.toLowerCase()}`)
    ?? verifiedById.get(`file:${path.toLowerCase()}`);
  if (byId) return byId;
  const exact = verifiedFiles.find((target) => (
    normalizePathKey(target.value) === normalizedCandidate
  ));
  if (exact) return exact;
  const suffixMatches = verifiedFiles.filter((target) => {
    const normalizedTarget = normalizePathKey(target.value);
    return normalizedTarget.endsWith(`/${normalizedCandidate}`)
      || normalizedCandidate.endsWith(`/${normalizedTarget}`)
  });
  if (suffixMatches.length === 1) return suffixMatches[0];
  if (suffixMatches.length > 1) return undefined;

  const basenameMatches = verifiedFiles.filter((target) => (
    basenameOf(target.value).toLowerCase() === basenameOf(normalizedCandidate).toLowerCase()
  ));
  return basenameMatches.length === 1 ? basenameMatches[0] : undefined;
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
  if (isProcessArtifactPath(path)) return false;
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
  // JSON and unknown extensions: only if explicitly declared as deliverable.
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
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const userBasenames = userAttachmentBasenames(messages);
  const inlineTargets = new Map<string, OpenTarget>();
  const assistantBlob = assistantTextBlob(messages);
  // Explicit assistant delivery claims are eligible after server verification.
  const deliveryManifestPaths = assistantMessages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "text" && typeof part.text === "string"
        ? extractAssistantDeliveryManifestPaths(part.text)
        : [],
    ),
  );
  const declaredPaths = [
    ...extractDeclaredDeliverablePaths(assistantBlob),
    ...deliveryManifestPaths,
  ];
  const explicitArtifactLinkPaths = extractExplicitArtifactLinkPaths(assistantBlob);
  const executedScriptBasenames = scriptsExecutedInTurn(messages);

  const candidatePaths: string[] = [];
  for (const candidate of deriveOpenTargets(assistantMessages, { includeFileMentions: false })) {
    if (candidate.kind === "file") candidatePaths.push(candidate.value);
  }
  for (const declared of [...declaredPaths, ...explicitArtifactLinkPaths]) candidatePaths.push(declared);

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

  const addVerifiedFile = (candidatePath: string) => {
    if (isProcessArtifactPath(candidatePath)) return;
    if (isBlockedUserPath(candidatePath, userBasenames)) return;
    if (!shouldShowAsTurnDeliverable(candidatePath, showContext)) return;
    const verified = findVerifiedFile(candidatePath, verifiedById, verifiedFiles);
    if (!verified || !isCollectibleArtifactTarget(verified)) return;
    if (isProcessArtifactPath(verified.value)) return;
    if (isBlockedUserPath(verified.value, userBasenames)) return;
    if (!shouldShowAsTurnDeliverable(verified.value, showContext)) return;
    inlineTargets.set(verified.id, verified);
  };

  for (const candidate of deriveOpenTargets(assistantMessages, { includeFileMentions: false })) {
    if (candidate.kind === "url" && isUserFacingLocalPreviewTarget(candidate)) {
      inlineTargets.set(candidate.id, candidate);
      continue;
    }
    if (candidate.kind === "file") {
      addVerifiedFile(candidate.value);
    }
  }

  // Explicit claims and artifact links are deliverable provenance without a tool entry.
  for (const declared of [...declaredPaths, ...explicitArtifactLinkPaths]) {
    addVerifiedFile(declared);
  }

  return collapseDuplicateFileTargets(Array.from(inlineTargets.values()));
}
