/**
 * Managed fleet vs discover (catalog) boundary.
 *
 * Discover → install / adopt → Managed fleet → configure (skills / MCP / models)
 */

import type { AgentManagementAgent } from "../../../../app/lib/desktop";
import type { AgentManagementHealthResult } from "./agent-management-health";
import {
  agentDisplayStatus,
  agentOwnership,
  sortAgentsByStatus,
  type AgentOwnership,
} from "./agent-card-model";

/** Product + common catalog keys that auto-enter the fleet when installed. */
export const AUTO_MANAGE_AGENT_KEYS = [
  "opencode",
  "claude",
  "codex",
  "hermes",
  "openclaw",
  "gemini",
  "onmyagent",
] as const;

const AUTO_MANAGE_KEY_SET = new Set<string>(AUTO_MANAGE_AGENT_KEYS);

export type FleetBucket = "managed" | "discover" | "extension";

export function isAutoManageKey(idOrProvider: string | null | undefined): boolean {
  const key = String(idOrProvider ?? "").trim().toLowerCase();
  return key.length > 0 && AUTO_MANAGE_KEY_SET.has(key);
}

export function isAgentInstalled(
  agent: { status?: string | null; error?: string | null; id?: string | null },
  health?: AgentManagementHealthResult | null,
): boolean {
  return agentDisplayStatus(agent, health) !== "missing";
}

function agentKeys(agent: Pick<AgentManagementAgent, "id" | "provider">): string[] {
  return [String(agent.id ?? ""), String(agent.provider ?? "")]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** True when this agent should appear in the primary managed fleet. */
export function isManagedFleetMember(
  agent: AgentManagementAgent,
  health?: AgentManagementHealthResult | null,
): boolean {
  const ownership = agentOwnership(agent);
  if (ownership === "extension") return false;
  // 未安装 never stays in 「我的智能体」— only 「可添加」.
  // Offline (installed but unhealthy) remains managed.
  if (!isAgentInstalled(agent, health)) return false;
  // User-owned store agents stay in the fleet while installed (incl. offline).
  if (ownership === "mine") return true;
  // Built-in product agents: installed ⇒ managed (no extra click).
  if (ownership === "product") return true;
  // Catalog: installed + auto-manage key ⇒ treat as fleet (auto-adopt persists).
  if (ownership === "catalog") {
    return agentKeys(agent).some((key) => isAutoManageKey(key));
  }
  return false;
}

/**
 * Rows for 「可添加」: not yet in the fleet (includes missing install targets
 * and store agents whose binary was removed).
 */
export function isDiscoverCandidate(
  agent: AgentManagementAgent,
  health?: AgentManagementHealthResult | null,
): boolean {
  if (agentOwnership(agent) === "extension") return false;
  return !isManagedFleetMember(agent, health);
}

/**
 * Persist catalog agent into custom-agents store (idempotent create).
 * Only auto-manage keys that are installed and still catalog drafts.
 */
export function shouldAutoAdoptToStore(
  agent: AgentManagementAgent,
  health?: AgentManagementHealthResult | null,
): boolean {
  if (agentOwnership(agent) !== "catalog") return false;
  if (!isAgentInstalled(agent, health)) return false;
  return agentKeys(agent).some((key) => isAutoManageKey(key));
}

export function fleetBucketOf(
  agent: AgentManagementAgent,
  health?: AgentManagementHealthResult | null,
): FleetBucket {
  if (agentOwnership(agent) === "extension") return "extension";
  if (isManagedFleetMember(agent, health)) return "managed";
  return "discover";
}

export function partitionAgentsForFleet(
  agents: ReadonlyArray<AgentManagementAgent>,
  healthById?: Readonly<Record<string, AgentManagementHealthResult | undefined>>,
): {
  managed: AgentManagementAgent[];
  discover: AgentManagementAgent[];
  extension: AgentManagementAgent[];
} {
  const managed: AgentManagementAgent[] = [];
  const discover: AgentManagementAgent[] = [];
  const extension: AgentManagementAgent[] = [];
  for (const agent of agents) {
    const health = healthById?.[agent.id] ?? null;
    const bucket = fleetBucketOf(agent, health);
    if (bucket === "managed") managed.push(agent);
    else if (bucket === "extension") extension.push(agent);
    else discover.push(agent);
  }
  return {
    managed: sortAgentsByStatus(managed),
    discover: sortAgentsByStatus(discover),
    extension,
  };
}

/** Managed + installed + enabled — usable as a config target in the fleet. */
export function isFleetConfigReadyAgent(
  agent: AgentManagementAgent,
  health?: AgentManagementHealthResult | null,
): boolean {
  if (agent.enabled === false) return false;
  return isManagedFleetMember(agent, health) && isAgentInstalled(agent, health);
}

/**
 * Skill-matrix columns only: managed + installed + enabled + healthy (online).
 * Offline / needs_auth / missing stay out — leftover skill folders after an
 * uninstall must not create empty dead columns.
 */
export function isSkillMatrixReadyAgent(
  agent: AgentManagementAgent,
  health?: AgentManagementHealthResult | null,
): boolean {
  if (!isFleetConfigReadyAgent(agent, health)) return false;
  return agentDisplayStatus(agent, health) === "online";
}

/**
 * Skill-matrix column key is interactive only when a matching healthy fleet
 * agent exists. No phantom / offline columns — except `onmyagent`, which is the
 * host product skill root (`~/.onmyagent/skills`) and always appears.
 */
export function isSkillAgentConfigTarget(
  skillAgentKey: string,
  agents: ReadonlyArray<AgentManagementAgent>,
  healthById?: Readonly<Record<string, AgentManagementHealthResult | undefined>>,
): boolean {
  const key = String(skillAgentKey ?? "").trim().toLowerCase();
  if (!key) return false;
  // Host app skills are always a matrix / config target.
  if (key === "onmyagent") return true;
  const matches = agents.filter((agent) => agentKeys(agent).includes(key));
  if (matches.length === 0) return false;
  return matches.some((agent) => isSkillMatrixReadyAgent(agent, healthById?.[agent.id] ?? null));
}

export function collectUnavailableSkillAgents<T extends string>(
  skillAgentKeys: ReadonlyArray<T>,
  agents: ReadonlyArray<AgentManagementAgent>,
  healthById?: Readonly<Record<string, AgentManagementHealthResult | undefined>>,
): Set<T> {
  const unavailable = new Set<T>();
  for (const key of skillAgentKeys) {
    if (!isSkillAgentConfigTarget(key, agents, healthById)) unavailable.add(key);
  }
  return unavailable;
}

/**
 * Ordered config keys for skills / MCP / model-provider sidebars.
 * = catalog of supported keys ∩ real fleet members (no invented columns).
 */
export function visibleFleetConfigAgentKeys<T extends string>(
  skillAgentKeys: ReadonlyArray<T>,
  agents: ReadonlyArray<AgentManagementAgent>,
  healthById?: Readonly<Record<string, AgentManagementHealthResult | undefined>>,
): T[] {
  return skillAgentKeys.filter((key) => isSkillAgentConfigTarget(key, agents, healthById));
}

function agentHasSkillDirs(agent: AgentManagementAgent): boolean {
  const dirs =
    (agent as { nativeSkillsDirs?: unknown }).nativeSkillsDirs
    ?? (agent as { native_skills_dirs?: unknown }).native_skills_dirs;
  return Array.isArray(dirs) && dirs.some((dir) => String(dir ?? "").trim().length > 0);
}

/**
 * Skill matrix columns: healthy product keys in fleet + healthy custom fleet
 * agents that declare nativeSkillsDirs. Offline agents (binary gone, stale
 * folders) never get a column.
 */
export function visibleSkillMatrixAgents(
  productSkillKeys: ReadonlyArray<string>,
  agents: ReadonlyArray<AgentManagementAgent>,
  healthById?: Readonly<Record<string, AgentManagementHealthResult | undefined>>,
): string[] {
  const product = visibleFleetConfigAgentKeys(productSkillKeys, agents, healthById);
  const productSet = new Set(product.map((key) => key.toLowerCase()));
  const custom: string[] = [];
  for (const agent of agents) {
    if (!isSkillMatrixReadyAgent(agent, healthById?.[agent.id] ?? null)) continue;
    if (!agentHasSkillDirs(agent)) continue;
    const id = String(agent.id ?? "").trim();
    if (!id || productSet.has(id.toLowerCase())) continue;
    // Skip if already represented by a product key (id/provider).
    if (agentKeys(agent).some((key) => productSet.has(key))) continue;
    custom.push(id);
  }
  custom.sort((a, b) => a.localeCompare(b, "zh"));
  return [...product, ...custom];
}

/**
 * MCP / model-provider sidebars: every managed fleet member, ordered like the
 * product skill catalog then custom ids. Does not invent columns for missing
 * product agents — only what is already in the fleet list.
 *
 * Prefer a known product key (id/provider match) so write-through adapters map
 * correctly; otherwise use the agent id (grok, mimo, …).
 */
export function visibleFleetSidebarAgents(
  productOrder: ReadonlyArray<string>,
  managedAgents: ReadonlyArray<AgentManagementAgent>,
): string[] {
  const order = productOrder.map((key) => key.toLowerCase());
  const orderIndex = new Map(order.map((key, index) => [key, index]));
  const keys: string[] = [];
  const seen = new Set<string>();

  const push = (key: string) => {
    const normalized = key.trim();
    if (!normalized) return;
    const lower = normalized.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    keys.push(normalized);
  };

  // Product keys first (catalog order), when a managed agent matches.
  for (const product of productOrder) {
    const productLower = product.toLowerCase();
    if (managedAgents.some((agent) => agentKeys(agent).includes(productLower))) {
      push(product);
    }
  }

  // Remaining managed agents by their id (custom fleet members).
  const custom: string[] = [];
  for (const agent of managedAgents) {
    const id = String(agent.id ?? "").trim();
    if (!id) continue;
    if (seen.has(id.toLowerCase())) continue;
    if (agentKeys(agent).some((key) => seen.has(key))) continue;
    custom.push(id);
  }
  custom.sort((a, b) => {
    const ai = orderIndex.get(a.toLowerCase());
    const bi = orderIndex.get(b.toLowerCase());
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.localeCompare(b, "zh");
  });
  for (const id of custom) push(id);

  return keys;
}

/**
 * Collect skill/provider keys actually present on fleet members (for debugging / counts).
 * Custom agents without a known skill key (e.g. grok, mimo) do not invent columns —
 * they remain in the fleet list only.
 */
export function fleetMemberConfigKeys(
  agents: ReadonlyArray<AgentManagementAgent>,
  knownKeys: ReadonlyArray<string>,
  healthById?: Readonly<Record<string, AgentManagementHealthResult | undefined>>,
): string[] {
  const known = new Set(knownKeys.map((k) => k.toLowerCase()));
  const found = new Set<string>();
  for (const agent of agents) {
    if (!isFleetConfigReadyAgent(agent, healthById?.[agent.id] ?? null)) continue;
    for (const key of agentKeys(agent)) {
      if (known.has(key)) found.add(key);
    }
  }
  return knownKeys.filter((key) => found.has(key.toLowerCase()));
}

/** Runtime picker / local tab: only fleet members that are enabled (and typically online). */
export function isRuntimeFleetPickerAgent(agent: AgentManagementAgent): boolean {
  if (agent.enabled === false) return false;
  // Catalog drafts never enter the runtime picker until adopted into the store.
  if (agentOwnership(agent) === "catalog") return false;
  if (agentOwnership(agent) === "extension") return false;
  // Missing install: not usable.
  if (!isAgentInstalled(agent)) return false;
  // Mine always; product when installed (already checked).
  return isManagedFleetMember(agent);
}

export function ownershipLabelKey(ownership: AgentOwnership): string {
  if (ownership === "mine") return "agent_manager.fleet_source_mine";
  if (ownership === "product") return "agent_manager.fleet_source_product";
  if (ownership === "catalog") return "agent_manager.fleet_source_catalog";
  return "agent_manager.fleet_source_extension";
}
