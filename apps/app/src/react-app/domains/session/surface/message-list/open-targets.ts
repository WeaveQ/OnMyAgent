import type { UIMessage } from "ai";
import {
  deriveOpenTargets,
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
  // File cards are deliverables, not a recap of every path mentioned in the
  // assistant text. Restrict file candidates to write-tool provenance from
  // this assistant turn so user uploads and artifacts from other turns do not
  // leak into the generated-artifact strip. Local preview URLs can still be
  // discovered from assistant text.
  for (const candidate of deriveOpenTargets(messages, { includeFileMentions: false })) {
    const normalizedCandidate = candidate.value.replace(/[\\]+/g, "/").replace(/^\.\//, "");
    if (
      candidate.kind === "file" &&
      (isLikelyUserUploadArtifactPath(candidate.value) ||
        matchesUserAttachment(candidate.value, userBasenames))
    ) {
      continue;
    }
    const verified = verifiedById.get(candidate.id)
      ?? (candidate.kind === "file"
        ? verifiedFiles.find((target) => {
          const normalizedTarget = target.value.replace(/[\\]+/g, "/").replace(/^\.\//, "");
          return normalizedTarget === normalizedCandidate
            || normalizedTarget.endsWith(`/${normalizedCandidate}`)
            || normalizedCandidate.endsWith(`/${normalizedTarget}`);
        })
        : undefined);
    if (
      verified?.kind === "file" &&
      (isLikelyUserUploadArtifactPath(verified.value) ||
        matchesUserAttachment(verified.value, userBasenames))
    ) {
      continue;
    }
    // Only intentional local previews (`localhost:port`), never internal
    // 127.0.0.1 bridges that leak from browser tool JSON.
    if (candidate.kind === "url" && isUserFacingLocalPreviewTarget(candidate)) {
      inlineTargets.set(candidate.id, verified ?? candidate);
      continue;
    }
    if (verified && isCollectibleArtifactTarget(verified)) {
      inlineTargets.set(verified.id, verified);
    }
  }
  return Array.from(inlineTargets.values()).slice(0, 4);
}
