/** Session route navigation-state helpers for agent-management deep links + expert install. */
import { installExpertPackage } from "../../app/lib/desktop";
import type { PendingAgentContext } from "../domains/agents";
import type { SessionAgentManagementIntent } from "../domains/session";

export function readStringStateField(state: unknown, key: string) {
  if (!state || typeof state !== "object") return null;
  const value = Reflect.get(state, key);
  return typeof value === "string" ? value.trim() || null : null;
}

export function readSessionAgentManagementIntent(
  state: unknown,
): SessionAgentManagementIntent | null {
  const action = readStringStateField(state, "agentManagementAction");
  if (action !== "createProvider") return null;
  return {
    action,
    key: readStringStateField(state, "agentManagementActionKey") ?? action,
  };
}

export function clearSessionAgentManagementIntentState(state: unknown) {
  if (!state || typeof state !== "object") return undefined;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (
      key === "agentManagementAction" ||
      key === "agentManagementActionKey"
    ) {
      continue;
    }
    next[key] = Reflect.get(state, key);
  }
  return next;
}

export async function installMarketplaceExpertAfterSessionCreated(
  agent: PendingAgentContext,
) {
  const marketplaceExpert = agent.marketplaceExpert;
  if (!marketplaceExpert || marketplaceExpert.source !== "builtin") return;
  try {
    await installExpertPackage({
      source: "builtin",
      marketplace: "experts",
      packageName: marketplaceExpert.packageName,
    });
  } catch (error) {
    console.warn("[expert-marketplace] failed to install expert package", error);
  }
}
