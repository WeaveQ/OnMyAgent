import type { ExpertMarketplaceEntry } from "./types";

export type MarketplaceExpertStartPrompt = {
  prompt: string;
  template: boolean;
};

const LOGISTICS_EXPERT_PACKAGES = new Set([
  "order-dispatch-specialist",
  "fleet-management-specialist",
  "fulfillment-specialist",
  "logistics-finance-specialist",
]);

export function resolveMarketplaceExpertStartPrompt(
  expert: Pick<
    ExpertMarketplaceEntry,
    "packageName" | "promptTemplates" | "quickPrompts"
  >,
  initialPrompt?: string,
): MarketplaceExpertStartPrompt | null {
  const explicitPrompt = initialPrompt?.trim();
  if (explicitPrompt) {
    return { prompt: explicitPrompt, template: false };
  }
  if (!LOGISTICS_EXPERT_PACKAGES.has(expert.packageName)) return null;

  const firstTemplate = expert.promptTemplates[0]?.template.trim();
  if (firstTemplate) {
    return { prompt: firstTemplate, template: true };
  }

  const firstQuickPrompt = expert.quickPrompts[0]?.trim();
  return firstQuickPrompt
    ? { prompt: firstQuickPrompt, template: false }
    : null;
}
