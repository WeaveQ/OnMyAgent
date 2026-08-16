import type { ExpertMarketplaceEntry } from "../plugins";
import { createExpertOperationId, type PendingAgentContext } from "./pending-agent-store";

export function buildPendingAgentFromMarketplaceExpert(
  expert: ExpertMarketplaceEntry,
): PendingAgentContext {
  return {
    id: expert.id,
    name: expert.displayName,
    description: expert.description,
    avatar: {
      avatarStyle: "robot",
      avatarOptionId: "marketplace-expert",
      customAvatarDataUrl: null,
      avatarUrl: expert.avatarUrl,
      avatarBackground: "var(--dls-primary-soft)",
    },
    systemPrompt: expert.systemPrompt,
    quickPrompts: expert.quickPrompts.slice(0, 3),
    promptTemplates: expert.promptTemplates.slice(0, 3),
    teamWorkflow: expert.teamWorkflow ?? undefined,
    skillIds: [...expert.skills],
    introStyle: expert.introStyle,
    approvedAgentIds: [...expert.approvedAgentIds],
    operationId: createExpertOperationId(),
    draftCreatedAt: Date.now(),
    draftSource: "agent-selection",
    marketplaceExpert: {
      source: expert.source,
      packageName: expert.packageName,
      packagePath: expert.packagePath,
    },
  };
}
