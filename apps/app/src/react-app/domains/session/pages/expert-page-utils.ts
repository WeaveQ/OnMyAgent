/**
 * Pure helpers for ExpertPage (marketplace matching + feature category mapping).
 */

import {
  findBuiltinMarketplaceExpertById,
  isBuiltinMarketplaceExpertAgentId,
} from "../expert-marketplace/data";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";
import { normalizeExpertMarketplaceCategoryId } from "../expert-marketplace/categories";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import type { PendingAgentContext } from "../../agents";

export function expertFeatureCategoryForCategoryId(
  categoryId: string | null | undefined,
): AssistantCategoryId {
  return normalizeExpertMarketplaceCategoryId(categoryId) ===
    "product-development"
    ? "code"
    : "office";
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
