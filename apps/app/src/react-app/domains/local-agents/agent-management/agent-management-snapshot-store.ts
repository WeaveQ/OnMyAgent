/**
 * Module-level Agent Management snapshot cache + prewarm.
 *
 * Shared by AgentManagementPage and shell prewarm callers (session / welcome)
 * so the first open of 管理 can paint from cache.
 */
import {
  agentManagementSnapshot,
  type AgentManagementSnapshot,
} from "../../../../app/lib/desktop";
import {
  addInFlightDomains,
  applyPartialDomainSnapshotToLatest,
  DEFAULT_MANAGEMENT_DOMAIN_TTL_MS,
  domainsNotInFlight,
  markDomainsFetched,
  missingDomains,
  removeInFlightDomains,
  type DomainFreshnessMap,
  type ManagementLoadDomain,
} from "./agent-management-load-cache";

export type AgentManagerSnapshotCacheEntry = {
  snapshot: AgentManagementSnapshot;
  /** Per-domain freshness; independent TTL so skills/mcp can lag core. */
  domains: DomainFreshnessMap;
};

/** Soft TTL: re-entry within this window reuses cache without network. */
export const AGENT_MANAGER_SNAPSHOT_TTL_MS = DEFAULT_MANAGEMENT_DOMAIN_TTL_MS;

const AGENT_MANAGER_SNAPSHOT_CACHE = new Map<
  string,
  AgentManagerSnapshotCacheEntry
>();

/**
 * Per-workspace domains currently mid-fetch. Concurrent tab loads + prewarm
 * gate here so a late mcp response never races a second core fetch.
 */
const AGENT_MANAGER_DOMAIN_INFLIGHT = new Map<
  string,
  Set<ManagementLoadDomain>
>();

export function agentManagerCacheKey(workspaceRoot: string): string {
  return workspaceRoot.trim() || "__default_workspace__";
}

export function readCachedAgentManagerSnapshot(
  cacheKey: string,
): AgentManagementSnapshot | null {
  return AGENT_MANAGER_SNAPSHOT_CACHE.get(cacheKey)?.snapshot ?? null;
}

export function readCachedAgentManagerDomains(
  cacheKey: string,
): DomainFreshnessMap {
  return AGENT_MANAGER_SNAPSHOT_CACHE.get(cacheKey)?.domains ?? {};
}

export function writeCachedAgentManagerSnapshot(
  cacheKey: string,
  snapshot: AgentManagementSnapshot,
  loadedDomains?: readonly ManagementLoadDomain[],
): void {
  const previous = AGENT_MANAGER_SNAPSHOT_CACHE.get(cacheKey);
  const domains = markDomainsFetched(
    previous?.domains,
    loadedDomains ??
      (snapshot.loadedDomains as ManagementLoadDomain[] | undefined) ?? [
        "core",
        "skills",
        "mcp",
      ],
  );
  AGENT_MANAGER_SNAPSHOT_CACHE.set(cacheKey, { snapshot, domains });
}

export function getAgentManagerDomainInFlight(
  cacheKey: string,
): Set<ManagementLoadDomain> {
  return (
    AGENT_MANAGER_DOMAIN_INFLIGHT.get(cacheKey) ??
    new Set<ManagementLoadDomain>()
  );
}

export function setAgentManagerDomainInFlight(
  cacheKey: string,
  domains: Set<ManagementLoadDomain>,
): void {
  if (domains.size === 0) {
    AGENT_MANAGER_DOMAIN_INFLIGHT.delete(cacheKey);
    return;
  }
  AGENT_MANAGER_DOMAIN_INFLIGHT.set(cacheKey, domains);
}

/** Test helper: clear module caches between tests. */
export function resetAgentManagerSnapshotStoreForTests(): void {
  AGENT_MANAGER_SNAPSHOT_CACHE.clear();
  AGENT_MANAGER_DOMAIN_INFLIGHT.clear();
}

export type PrefetchAgentManagementDomainsInput = {
  workspaceRoot: string;
  domains?: ManagementLoadDomain[];
  force?: boolean;
  includeDiscoverable?: boolean;
};

/**
 * Fetch missing management domains into the shared module cache.
 * Safe to call from session/welcome without mounting AgentManagementPage.
 * Concurrent callers share in-flight work per domain.
 */
export async function prefetchAgentManagementDomains(
  input: PrefetchAgentManagementDomainsInput,
): Promise<AgentManagementSnapshot | null> {
  const root = input.workspaceRoot.trim();
  if (!root) return null;

  const cacheKey = agentManagerCacheKey(root);
  const needed: ManagementLoadDomain[] =
    input.domains && input.domains.length > 0
      ? input.domains
      : (["core"] as ManagementLoadDomain[]);

  const domainState = readCachedAgentManagerDomains(cacheKey);
  const staleOrMissing = input.force
    ? needed
    : missingDomains(
        domainState,
        needed,
        Date.now(),
        AGENT_MANAGER_SNAPSHOT_TTL_MS,
      );

  const flying = getAgentManagerDomainInFlight(cacheKey);
  const toFetch = domainsNotInFlight(staleOrMissing, flying);

  if (toFetch.length === 0) {
    return readCachedAgentManagerSnapshot(cacheKey);
  }

  setAgentManagerDomainInFlight(
    cacheKey,
    addInFlightDomains(flying, toFetch),
  );

  try {
    const partial = await agentManagementSnapshot({
      workspaceRoot: root,
      domains: toFetch,
      includeModels: false,
      includeDiscoverable: input.includeDiscoverable ?? true,
    });
    const loaded =
      (partial.loadedDomains as ManagementLoadDomain[] | undefined) ?? toFetch;
    const latest = readCachedAgentManagerSnapshot(cacheKey);
    const merged = applyPartialDomainSnapshotToLatest(latest, partial, loaded);
    writeCachedAgentManagerSnapshot(cacheKey, merged, loaded);
    return merged;
  } catch (error) {
    console.warn("[agent-management] snapshot prewarm failed", error);
    return readCachedAgentManagerSnapshot(cacheKey);
  } finally {
    const still = getAgentManagerDomainInFlight(cacheKey);
    setAgentManagerDomainInFlight(
      cacheKey,
      removeInFlightDomains(still, toFetch),
    );
  }
}

/**
 * Idle-friendly prewarm for the default 管理 tab (agents → core domain).
 * Failures are swallowed; never block UX.
 */
export async function prewarmAgentManagementCore(
  workspaceRoot: string,
): Promise<void> {
  await prefetchAgentManagementDomains({
    workspaceRoot,
    domains: ["core"],
    includeDiscoverable: true,
  }).catch(() => null);
}
