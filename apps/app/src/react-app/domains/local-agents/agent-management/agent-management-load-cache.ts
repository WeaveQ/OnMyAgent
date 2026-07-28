/**
 * Pure helpers for agent-management snapshot domain loading and cache TTL.
 * Keep free of React / Electron so unit tests can run under bun.
 */

export type ManagementLoadDomain = "core" | "skills" | "mcp" | "providers";

export type AgentManagementPanelId =
  | "providers"
  | "agents"
  | "skills"
  | "mcp"
  | "archive";

export type DomainFreshnessMap = Partial<
  Record<ManagementLoadDomain, { fetchedAt: number }>
>;

export type DomainSnapshotFields = {
  agents?: unknown[];
  skills?: unknown[];
  providers?: unknown;
  mcp?: unknown;
  loadedDomains?: ManagementLoadDomain[];
};

export const MANAGEMENT_LOAD_DOMAINS: readonly ManagementLoadDomain[] = [
  "core",
  "skills",
  "mcp",
  "providers",
] as const;

export const DEFAULT_MANAGEMENT_DOMAIN_TTL_MS = 60_000;

/** Which snapshot domains a panel needs before it can fully render. */
export function domainsForPanel(
  panel: AgentManagementPanelId | string,
): ManagementLoadDomain[] {
  switch (panel) {
    case "skills":
      // Matrix columns come from managed agents (core); inventory is skills.
      return ["core", "skills"];
    case "mcp":
      return ["mcp"];
    case "providers":
    case "agents":
      return ["core"];
    case "archive":
      // Archive is a separate server list; snapshot is optional chrome only.
      return [];
    default:
      return ["core"];
  }
}

/** Domains to re-fetch after agent membership mutations (adopt / CRUD). */
export function domainsForAgentMutation(): ManagementLoadDomain[] {
  return ["core"];
}

/** Domains to re-fetch after skill enable/disable/import (not open). */
export function domainsForSkillMutation(): ManagementLoadDomain[] {
  return ["skills", "core"];
}

export function normalizeManagementDomains(
  input: unknown,
): ManagementLoadDomain[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: ManagementLoadDomain[] = [];
  for (const item of input) {
    if (
      item === "core" ||
      item === "skills" ||
      item === "mcp" ||
      item === "providers"
    ) {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out.length > 0 ? out : null;
}

export function isDomainFresh(
  domains: DomainFreshnessMap | null | undefined,
  domain: ManagementLoadDomain,
  now = Date.now(),
  ttlMs = DEFAULT_MANAGEMENT_DOMAIN_TTL_MS,
): boolean {
  const entry = domains?.[domain];
  if (!entry || typeof entry.fetchedAt !== "number") return false;
  return now - entry.fetchedAt < ttlMs;
}

/**
 * Return domains from `needed` that are missing or past TTL.
 * Empty needed → empty (nothing to load).
 */
export function missingDomains(
  loaded: DomainFreshnessMap | null | undefined,
  needed: readonly ManagementLoadDomain[],
  now = Date.now(),
  ttlMs = DEFAULT_MANAGEMENT_DOMAIN_TTL_MS,
): ManagementLoadDomain[] {
  return needed.filter((domain) => !isDomainFresh(loaded, domain, now, ttlMs));
}

/** Mark domains as freshly loaded at `fetchedAt`. */
export function markDomainsFetched(
  previous: DomainFreshnessMap | null | undefined,
  domains: readonly ManagementLoadDomain[],
  fetchedAt = Date.now(),
): DomainFreshnessMap {
  const next: DomainFreshnessMap = { ...(previous ?? {}) };
  for (const domain of domains) {
    next[domain] = { fetchedAt };
  }
  return next;
}

/**
 * Merge a partial domain response into the previous snapshot.
 * Only overwrites fields for domains present in `loadedDomains` (or `requested`).
 */
export function mergeManagementDomainSnapshot<T extends DomainSnapshotFields>(
  previous: T | null | undefined,
  partial: T,
  requested?: readonly ManagementLoadDomain[] | null,
): T {
  const loaded =
    normalizeManagementDomains(partial.loadedDomains) ??
    normalizeManagementDomains(requested) ??
    ([...MANAGEMENT_LOAD_DOMAINS] as ManagementLoadDomain[]);

  const base = (previous ?? partial) as T;
  const next = {
    ...base,
    generatedAt:
      (partial as { generatedAt?: number }).generatedAt ??
      (base as { generatedAt?: number }).generatedAt,
    workspaceRoot:
      (partial as { workspaceRoot?: string }).workspaceRoot ??
      (base as { workspaceRoot?: string }).workspaceRoot,
  } as T & DomainSnapshotFields;

  if (loaded.includes("core")) {
    if (Array.isArray(partial.agents)) next.agents = partial.agents;
    if (partial.providers != null) next.providers = partial.providers;
  }
  // providers-only: inventory without fleet scan (settings AI custom providers).
  if (loaded.includes("providers") && !loaded.includes("core")) {
    if (partial.providers != null) next.providers = partial.providers;
  }
  if (loaded.includes("skills") && Array.isArray(partial.skills)) {
    next.skills = partial.skills;
  }
  if (loaded.includes("mcp") && partial.mcp != null) {
    next.mcp = partial.mcp;
  }

  const prevLoaded = normalizeManagementDomains(
    (previous as DomainSnapshotFields | null | undefined)?.loadedDomains,
  );
  const mergedLoaded = new Set<ManagementLoadDomain>([
    ...(prevLoaded ?? []),
    ...loaded,
  ]);
  next.loadedDomains = MANAGEMENT_LOAD_DOMAINS.filter((d) =>
    mergedLoaded.has(d),
  );

  return next as T;
}

/**
 * Apply skill inventory counts onto agent rows (used when skills load after core).
 * Mirrors desktop handler skillKey rules for custom vs product agents.
 */
export function applySkillCountsToAgents<
  TAgent extends { id?: string; provider?: string; skillCount?: number },
  TSkill extends { agents?: string[] },
>(agents: TAgent[], skills: TSkill[]): TAgent[] {
  const skillCounts = new Map<string, number>();
  for (const skill of skills) {
    for (const agent of skill.agents ?? []) {
      const key = String(agent).toLowerCase();
      skillCounts.set(key, (skillCounts.get(key) ?? 0) + 1);
    }
  }
  return agents.map((agent) => {
    const skillKey =
      agent.provider === "custom"
        ? String(agent.id ?? "").toLowerCase()
        : String(agent.provider ?? "").toLowerCase();
    const skillCount =
      skillCounts.get(skillKey) ??
      skillCounts.get(String(agent.id ?? "").toLowerCase()) ??
      skillCounts.get(String(agent.provider ?? "").toLowerCase()) ??
      0;
    return { ...agent, skillCount };
  });
}

/** True when first paint of agents panel can proceed without skills/mcp. */
export function coreReadyForAgentsPanel(
  loaded: DomainFreshnessMap | null | undefined,
  now = Date.now(),
  ttlMs = DEFAULT_MANAGEMENT_DOMAIN_TTL_MS,
): boolean {
  // Fresh core OR any core ever loaded (stale still paints via cache-first).
  return Boolean(loaded?.core) || isDomainFresh(loaded, "core", now, ttlMs);
}

/**
 * Domains from `needed` that are not already in flight.
 * Overlapping concurrent loads must gate per-domain so a late mcp response
 * does not start a second core fetch, and vice versa.
 */
export function domainsNotInFlight(
  needed: readonly ManagementLoadDomain[],
  inFlight: ReadonlySet<ManagementLoadDomain> | readonly ManagementLoadDomain[],
): ManagementLoadDomain[] {
  const flying =
    inFlight instanceof Set
      ? inFlight
      : new Set<ManagementLoadDomain>(inFlight);
  return needed.filter((domain) => !flying.has(domain));
}

/** Immutable-style add of domains to an in-flight set. */
export function addInFlightDomains(
  inFlight: ReadonlySet<ManagementLoadDomain> | readonly ManagementLoadDomain[],
  domains: readonly ManagementLoadDomain[],
): Set<ManagementLoadDomain> {
  const next = new Set<ManagementLoadDomain>(
    inFlight instanceof Set ? inFlight : inFlight,
  );
  for (const domain of domains) next.add(domain);
  return next;
}

/** Immutable-style remove of domains from an in-flight set. */
export function removeInFlightDomains(
  inFlight: ReadonlySet<ManagementLoadDomain> | readonly ManagementLoadDomain[],
  domains: readonly ManagementLoadDomain[],
): Set<ManagementLoadDomain> {
  const next = new Set<ManagementLoadDomain>(
    inFlight instanceof Set ? inFlight : inFlight,
  );
  for (const domain of domains) next.delete(domain);
  return next;
}

/**
 * Apply a partial domain response onto the *latest* known snapshot.
 * Callers must pass the current cache entry (re-read after await), not a
 * start-of-request snapshot, so concurrent domain loads cannot wipe each other.
 */
export function applyPartialDomainSnapshotToLatest<T extends DomainSnapshotFields>(
  latest: T | null | undefined,
  partial: T,
  loadedDomains?: readonly ManagementLoadDomain[] | null,
): T {
  let merged = mergeManagementDomainSnapshot(latest, partial, loadedDomains);
  const loaded =
    normalizeManagementDomains(partial.loadedDomains) ??
    normalizeManagementDomains(loadedDomains) ??
    [];
  if (
    loaded.includes("skills") &&
    Array.isArray(merged.agents) &&
    Array.isArray(merged.skills)
  ) {
    merged = {
      ...merged,
      agents: applySkillCountsToAgents(
        merged.agents as Array<{ id?: string; provider?: string; skillCount?: number }>,
        merged.skills as Array<{ agents?: string[] }>,
      ),
    } as T;
  }
  return merged;
}
