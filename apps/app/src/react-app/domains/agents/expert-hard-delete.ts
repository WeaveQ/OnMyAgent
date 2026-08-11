/**
 * Hard-delete an expert: sessions + registry row + marketplace packages.
 * Product builtins (creation coach) are refused.
 */
import {
  deleteExpertPackage,
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
import type { AgentRegistry } from "./agent-registry-types";
import { shouldClearLocalBindingOnDelete } from "./expert-session-lifecycle";

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

export function packageNameForAgent(input: {
  agentId: string;
  registry: AgentRegistry | null;
}): string | null {
  const candidates = packageNameCandidatesForAgent(input);
  return candidates.at(-1) ?? null;
}

const pendingPackageDeleteOperationIds = new Map<string, string>();

export async function deleteExpertPackageForAgent(
  input: {
    agentId: string;
    packageName: string;
  },
  dependencies: {
    deletePackage?: typeof deleteExpertPackage;
    createOperationId?: () => string;
    operationIds?: Map<string, string>;
  } = {},
): Promise<void> {
  const deletePackage = dependencies.deletePackage ?? deleteExpertPackage;
  const createOperationId = dependencies.createOperationId ?? (() => crypto.randomUUID());
  const operationIds = dependencies.operationIds ?? pendingPackageDeleteOperationIds;
  const identityKey = `${input.agentId}\0${input.packageName}`;
  const operationId = operationIds.get(identityKey) ?? createOperationId();
  operationIds.set(identityKey, operationId);
  const result = await deletePackage({
    operationId,
    agentId: input.agentId,
    packageName: input.packageName,
    marketplace: "my-experts",
  });
  if (result.state !== "completed") {
    const failedStep = result.steps.find(
      (step) => step.state === "failed" || step.state === "pending",
    );
    throw new Error(failedStep?.code ?? "expert_package_delete_incomplete");
  }
  operationIds.delete(identityKey);
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
 * Delete custom marketplace packages through the replay-safe desktop saga.
 *
 * The marketplace package name is authoritative when present, with the agent id
 * retained only as the legacy fallback. A partial result keeps its operation id
 * for retry and is intentionally fatal so callers do not remove the registry
 * row while package cleanup is incomplete.
 */
export async function deleteExpertPackagesForAgent(input: {
  agentId: string;
  registry: AgentRegistry | null;
}): Promise<void> {
  if (!isElectronRuntime()) return;
  const packageName = packageNameForAgent(input);
  if (!packageName) return;

  await deleteExpertPackageForAgent({
    agentId: input.agentId.trim(),
    packageName,
  });
  notifyExpertPackagesChanged();
}

/** Clear session↔agent bindings and expert session tags for deleted sessions. */
export function clearExpertLocalSessionBindings(sessionIds: readonly string[]) {
  for (const sessionId of sessionIds) {
    if (!shouldClearLocalBindingOnDelete(sessionId)) continue;
    const id = sessionId.trim();
    writeCustomAgentIdForSession(id, null);
    writeSessionAgentSnapshot(id, null);
  }
}
