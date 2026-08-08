/** Session route navigation-state helpers for agent-management deep links + expert install. */
import type { PendingAgentContext } from "../../domains/agents";
import { ensureMarketplaceExpertInstalled } from "../../domains/plugins";
import type { SessionAgentManagementIntent } from "../../domains/session";

export function readStringStateField(state: unknown, key: string) {
  if (!state || typeof state !== "object") return null;
  const value = Reflect.get(state, key);
  return typeof value === "string" ? value.trim() || null : null;
}

export function readSessionAgentManagementIntent(
  state: unknown,
): SessionAgentManagementIntent | null {
  const action = readStringStateField(state, "agentManagementAction");
  if (action !== "openPanel") return null;
  const panelRaw = readStringStateField(state, "agentManagementPanel");
  const panel =
    panelRaw === "agents" || panelRaw === "skills" ? panelRaw : undefined;
  return {
    action: "openPanel",
    panel,
    key: readStringStateField(state, "agentManagementActionKey") ?? action,
  };
}

export function clearSessionAgentManagementIntentState(state: unknown) {
  if (!state || typeof state !== "object") return undefined;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (
      key === "agentManagementAction" ||
      key === "agentManagementActionKey" ||
      key === "agentManagementPanel"
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
  if (!marketplaceExpert) return;
  try {
    await ensureMarketplaceExpertInstalled(marketplaceExpert);
  } catch (error) {
    console.warn("[expert-marketplace] failed to install expert package", error);
  }
}
