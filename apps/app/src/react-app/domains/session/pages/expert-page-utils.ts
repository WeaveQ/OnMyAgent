/**
 * Pure helpers for ExpertPage (marketplace matching + feature category mapping).
 */

import {
  findBuiltinMarketplaceExpertById,
  isBuiltinMarketplaceExpertAgentId,
} from "@/react-app/domains/plugins";
import type { ExpertMarketplaceEntry } from "@/react-app/domains/plugins";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import type { PendingAgentContext } from "../../agents";

export function expertFeatureCategoryForCategoryId(
  _categoryId: string | null | undefined,
): AssistantCategoryId {
  return "office";
}

export function expertFeatureCategoryForAgent(
  agentId: string | null | undefined,
): AssistantCategoryId {
  if (!agentId) return "office";
  return expertFeatureCategoryForCategoryId(
    findBuiltinMarketplaceExpertById(agentId)?.categoryId,
  );
}

export function marketplaceExpertMatchesAgentId(
  expert: ExpertMarketplaceEntry,
  agentId: string | null | undefined,
): boolean {
  const normalized = agentId?.trim();
  if (!normalized) return false;
  if (expert.source === "builtin") {
    return isBuiltinMarketplaceExpertAgentId(expert, normalized);
  }
  return (
    normalized === expert.id ||
    normalized === expert.packageName ||
    normalized === expert.leadAgentName
  );
}

export function pendingAgentMatchesMarketplaceExpert(
  agent: PendingAgentContext,
  expert: ExpertMarketplaceEntry,
): boolean {
  return (
    marketplaceExpertMatchesAgentId(expert, agent.id) ||
    agent.marketplaceExpert?.packageName === expert.packageName ||
    agent.marketplaceExpert?.packagePath === expert.packagePath
  );
}
