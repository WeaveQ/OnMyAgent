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

/** Agent helper scripts — never show as session deliverable cards. */
const INTERMEDIATE_SCRIPT_EXTENSIONS = new Set([
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
]);

function isIntermediateAgentScript(path: string): boolean {
  const base = basenameOf(path).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  return INTERMEDIATE_SCRIPT_EXTENSIONS.has(base.slice(dot));
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
  // Inbox renames keep the original name as a suffix: `{ts}-{i}-{original}`.
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

  const addVerifiedFile = (candidatePath: string, candidate?: OpenTarget) => {
    if (isBlockedUserPath(candidatePath, userBasenames)) return;
    if (isIntermediateAgentScript(candidatePath)) return;
    const verified = findVerifiedFile(candidatePath, verifiedById, verifiedFiles)
      ?? (candidate && isCollectibleArtifactTarget({ ...candidate, exists: true })
        ? { ...candidate, exists: true as const }
        : undefined);
    if (!verified || !isCollectibleArtifactTarget(verified)) return;
    if (isBlockedUserPath(verified.value, userBasenames)) return;
    if (isIntermediateAgentScript(verified.value)) return;
    inlineTargets.set(verified.id, verified);
  };

  // 1) Write-tool / write-like shell provenance from this turn.
  for (const candidate of deriveOpenTargets(messages, { includeFileMentions: false })) {
    if (candidate.kind === "url" && isUserFacingLocalPreviewTarget(candidate)) {
      inlineTargets.set(candidate.id, candidate);
      continue;
    }
    if (candidate.kind === "file") {
      addVerifiedFile(candidate.value, candidate);
    }
  }

  // 2) Assistant explicitly declares a deliverable path in prose (spreadsheet
  //    scripts often write via node/shell without write-tool metadata).
  for (const declared of extractDeclaredDeliverablePaths(assistantTextBlob(messages))) {
    addVerifiedFile(declared);
  }

  return Array.from(inlineTargets.values()).slice(0, 4);
}
