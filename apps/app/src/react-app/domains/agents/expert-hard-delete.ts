/**
 * Hard-delete an expert: sessions + registry row + marketplace packages.
 * Product builtins (creation coach) are refused.
 */
import {
  uninstallExpertPackage,
  writeUserAgentRegistry,
} from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import {
  isBuiltinAgentId,
  isBuiltinAgentRecord,
} from "./agent-builtin";
import { serializeUserAgentRegistry } from "./agent-registry";
import {
  useAgentRegistryStore,
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "./agent-registry-store";
import { removeExpertSession } from "./agent-session-state";
import type { AgentRegistry } from "./agent-registry-types";

export const EXPERT_PACKAGES_CHANGED_EVENT = "onmyagent.expert-packages-changed";

export function notifyExpertPackagesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EXPERT_PACKAGES_CHANGED_EVENT));
}

export function canHardDeleteExpert(
  agentId: string,
  registry: AgentRegistry | null,
): boolean {
  const id = agentId.trim();
  if (!id) return false;
  if (isBuiltinAgentId(id)) return false;
  const agent = registry?.agents.find((item) => item.id === id);
  if (agent && isBuiltinAgentRecord(agent)) return false;
  return true;
}

export function packageNameCandidatesForAgent(input: {
  agentId: string;
  registry: AgentRegistry | null;
}): string[] {
  const id = input.agentId.trim();
  if (!id) return [];
  const agent = input.registry?.agents.find((item) => item.id === id);
  const names = new Set<string>();
  names.add(id);
  const packageName = agent?.marketplacePackageName?.trim();
  if (packageName) names.add(packageName);
  return [...names];
}

/**
 * Remove expert definition from local registry (disk + in-memory store).
 */
export async function removeExpertFromRegistry(input: {
  agentId: string;
  registry: AgentRegistry | null;
}): Promise<AgentRegistry | null> {
  const id = input.agentId.trim();
  const registry = input.registry;
  if (!id || !registry) return registry;
  if (!canHardDeleteExpert(id, registry)) return registry;
  if (!registry.agents.some((agent) => agent.id === id)) return registry;

  const nextRegistry: AgentRegistry = {
    ...registry,
    updatedAt: new Date().toISOString(),
    agents: registry.agents.filter((agent) => agent.id !== id),
  };

  if (isElectronRuntime()) {
    await writeUserAgentRegistry(serializeUserAgentRegistry(nextRegistry));
  }
  useAgentRegistryStore.getState().setRegistry(nextRegistry);
  return nextRegistry;
}

/**
 * Uninstall marketplace packages for this agent from both local marketplaces.
 */
export async function uninstallExpertPackagesForAgent(input: {
  agentId: string;
  registry: AgentRegistry | null;
}): Promise<void> {
  if (!isElectronRuntime()) return;
  const candidates = packageNameCandidatesForAgent(input);
  if (candidates.length === 0) return;

  await Promise.allSettled(
    candidates.flatMap((packageName) => [
      uninstallExpertPackage({ marketplace: "my-experts", packageName }),
      uninstallExpertPackage({ marketplace: "experts", packageName }),
    ]),
  );
  notifyExpertPackagesChanged();
}

/** Clear session↔agent bindings and expert session tags for deleted sessions. */
export function clearExpertLocalSessionBindings(sessionIds: readonly string[]) {
  for (const sessionId of sessionIds) {
    const id = sessionId.trim();
    if (!id || id.startsWith("draft:")) continue;
    writeCustomAgentIdForSession(id, null);
    writeSessionAgentSnapshot(id, null);
    removeExpertSession(id);
  }
}
