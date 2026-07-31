import type { UIMessage } from "ai";
import {
  deriveOpenTargets,
  isCollectibleArtifactTarget,
  isUserFacingLocalPreviewTarget,
  type OpenTarget,
} from "../../artifacts/open-target";

export function selectTurnOpenTargets(
  messages: UIMessage[],
  verifiedTargets: OpenTarget[] | undefined,
) {
  const verifiedById = new Map((verifiedTargets ?? []).map((target) => [target.id, target] as const));
  const verifiedFiles = (verifiedTargets ?? []).filter(
    (target) => target.kind === "file" && target.exists === true,
  );
  const inlineTargets = new Map<string, OpenTarget>();
  // File cards are deliverables, not a recap of every path mentioned in the
  // assistant text. Restrict file candidates to write-tool provenance from
  // this assistant turn so user uploads and artifacts from other turns do not
  // leak into the generated-artifact strip. Local preview URLs can still be
  // discovered from assistant text.
  for (const candidate of deriveOpenTargets(messages, { includeFileMentions: false })) {
    const normalizedCandidate = candidate.value.replace(/[\\]+/g, "/").replace(/^\.\//, "");
    const verified = verifiedById.get(candidate.id)
      ?? (candidate.kind === "file"
        ? verifiedFiles.find((target) => {
          const normalizedTarget = target.value.replace(/[\\]+/g, "/").replace(/^\.\//, "");
          return normalizedTarget === normalizedCandidate
            || normalizedTarget.endsWith(`/${normalizedCandidate}`)
            || normalizedCandidate.endsWith(`/${normalizedTarget}`);
        })
        : undefined);
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
