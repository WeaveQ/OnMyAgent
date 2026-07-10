import type { PendingAgentContext } from "../../agents/pending-agent-store";
import type { ExpertMarketplaceEntry } from "./types";

export function buildPendingAgentFromMarketplaceExpert(
  expert: ExpertMarketplaceEntry,
): PendingAgentContext {
  const source = expert.source === "mine" ? "mine" : "builtin";
  return {
    id: expert.id,
    name: expert.displayName,
    description: expert.description,
    avatar: {
      avatarStyle: "机器人",
      avatarOptionId: "marketplace-expert",
      customAvatarDataUrl: null,
      avatarUrl: expert.avatarUrl,
      avatarBackground: "var(--ow-primary-light)",
    },
    systemPrompt: expert.systemPrompt,
    quickPrompts: expert.quickPrompts.slice(0, 3),
    conversationStartId: Date.now(),
    draftSource: "agent-selection",
    marketplaceExpert: {
      source,
      packageName: expert.packageName,
      packagePath: expert.packagePath,
    },
  };
}
