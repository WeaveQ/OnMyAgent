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
  const inlineTargets = new Map<string, OpenTarget>();
  for (const candidate of deriveOpenTargets(messages, { includeFileMentions: true })) {
    const verified = verifiedById.get(candidate.id);
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
