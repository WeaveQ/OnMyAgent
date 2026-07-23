import { describe, expect, it } from "bun:test";

import {
  addInFlightDomains,
  applyPartialDomainSnapshotToLatest,
  applySkillCountsToAgents,
  coreReadyForAgentsPanel,
  DEFAULT_MANAGEMENT_DOMAIN_TTL_MS,
  domainsForAgentMutation,
  domainsForPanel,
  domainsForSkillMutation,
  domainsNotInFlight,
  isDomainFresh,
  markDomainsFetched,
  mergeManagementDomainSnapshot,
  missingDomains,
  normalizeManagementDomains,
  removeInFlightDomains,
} from "../src/react-app/domains/local-agents/agent-management/agent-management-load-cache";

describe("agent-management-load-cache", () => {
  it("maps panels to independent domain needs (agents/providers skip skills+mcp)", () => {
    expect(domainsForPanel("agents")).toEqual(["core"]);
    expect(domainsForPanel("providers")).toEqual(["core"]);
    expect(domainsForPanel("skills")).toEqual(["core", "skills"]);
    expect(domainsForPanel("mcp")).toEqual(["mcp"]);
    expect(domainsForPanel("archive")).toEqual([]);
  });

  it("scopes mutations so auto-adopt does not require skills+mcp", () => {
    expect(domainsForAgentMutation()).toEqual(["core"]);
    expect(domainsForSkillMutation()).toEqual(["skills", "core"]);
  });

  it("normalizes domain lists and drops unknowns", () => {
    expect(normalizeManagementDomains(undefined)).toBeNull();
    expect(normalizeManagementDomains([])).toBeNull();
    expect(normalizeManagementDomains(["core", "skills", "nope", "core"])).toEqual([
      "core",
      "skills",
    ]);
  });

  it("tracks per-domain freshness and missing domains", () => {
    const now = 1_000_000;
    const ttl = DEFAULT_MANAGEMENT_DOMAIN_TTL_MS;
    const loaded = markDomainsFetched({}, ["core"], now - 1_000);
    expect(isDomainFresh(loaded, "core", now, ttl)).toBe(true);
    expect(isDomainFresh(loaded, "skills", now, ttl)).toBe(false);
    expect(missingDomains(loaded, ["core", "skills", "mcp"], now, ttl)).toEqual([
      "skills",
      "mcp",
    ]);
    const stale = markDomainsFetched({}, ["core"], now - ttl - 1);
    expect(missingDomains(stale, ["core"], now, ttl)).toEqual(["core"]);
  });

  it("merges partial domain snapshots without wiping unloaded domains", () => {
    const previous = {
      generatedAt: 1,
      workspaceRoot: "/ws",
      agents: [{ id: "a1", provider: "claude", skillCount: 0 }],
      skills: [{ name: "old", agents: ["claude"] }],
      providers: { total: 1, byAgent: {}, databasePath: "/db" },
      mcp: { total: 2, servers: [{ id: "m1" }], generatedAt: 1, databasePath: "", apps: {}, countsByApp: {} },
      loadedDomains: ["core", "skills", "mcp"] as const,
    };
    const partialCore = {
      generatedAt: 2,
      workspaceRoot: "/ws",
      agents: [{ id: "a2", provider: "codex", skillCount: 0 }],
      skills: [],
      providers: { total: 3, byAgent: {}, databasePath: "/db" },
      mcp: { total: 0, servers: [], generatedAt: 2, databasePath: "", apps: {}, countsByApp: {} },
      loadedDomains: ["core"] as const,
    };
    const merged = mergeManagementDomainSnapshot(previous, partialCore, ["core"]);
    expect(merged.agents).toEqual(partialCore.agents);
    expect(merged.providers.total).toBe(3);
    // skills + mcp preserved from previous when not in loadedDomains
    expect(merged.skills).toEqual(previous.skills);
    expect(merged.mcp.total).toBe(2);
    expect(merged.loadedDomains).toEqual(["core", "skills", "mcp"]);
  });

  it("applies skill counts after deferred skills load", () => {
    const agents = [
      { id: "claude", provider: "claude", skillCount: 0 },
      { id: "mine-1", provider: "custom", skillCount: 0 },
    ];
    const skills = [
      { agents: ["claude", "codex"] },
      { agents: ["claude"] },
      { agents: ["mine-1"] },
    ];
    const next = applySkillCountsToAgents(agents, skills);
    expect(next[0].skillCount).toBe(2);
    expect(next[1].skillCount).toBe(1);
  });

  it("reports core readiness for agents first paint", () => {
    expect(coreReadyForAgentsPanel({})).toBe(false);
    expect(coreReadyForAgentsPanel(markDomainsFetched({}, ["core"], Date.now()))).toBe(true);
  });

  it("gates overlapping domain flights per-domain (not one global flight key)", () => {
    const flying = addInFlightDomains([], ["core"]);
    expect(domainsNotInFlight(["core", "mcp"], flying)).toEqual(["mcp"]);
    expect(domainsNotInFlight(["core"], flying)).toEqual([]);
    const afterMcp = addInFlightDomains(flying, ["mcp"]);
    expect([...afterMcp].sort()).toEqual(["core", "mcp"]);
    const afterCoreDone = removeInFlightDomains(afterMcp, ["core"]);
    expect([...afterCoreDone]).toEqual(["mcp"]);
    expect(domainsNotInFlight(["core", "skills"], afterCoreDone)).toEqual([
      "core",
      "skills",
    ]);
  });

  it("re-read latest merge: late mcp does not wipe agents written by concurrent core", () => {
    const corePartial = {
      generatedAt: 10,
      workspaceRoot: "/ws",
      agents: [{ id: "claude", provider: "claude", skillCount: 0 }],
      skills: [] as Array<{ name: string; agents: string[] }>,
      providers: { total: 1, byAgent: {}, databasePath: "/db" },
      mcp: { total: 0, servers: [] as Array<{ id: string }>, generatedAt: 10, databasePath: "", apps: {}, countsByApp: {} },
      loadedDomains: ["core"] as const,
    };
    // Simulate core completing first and writing the map.
    const afterCore = applyPartialDomainSnapshotToLatest(null, corePartial, ["core"]);
    expect(afterCore.agents).toHaveLength(1);

    // Late mcp response has empty agents[] (skills-only/mcp-only path); must merge onto latest.
    const mcpPartial = {
      generatedAt: 20,
      workspaceRoot: "/ws",
      agents: [] as typeof corePartial.agents,
      skills: [] as typeof corePartial.skills,
      providers: { total: 0, byAgent: {}, databasePath: "" },
      mcp: { total: 3, servers: [{ id: "s1" }], generatedAt: 20, databasePath: "/mcp", apps: {}, countsByApp: {} },
      loadedDomains: ["mcp"] as const,
    };
    // Bug pattern: merge against start-of-request null would base on mcpPartial → agents:[].
    const wipedIfStale = mergeManagementDomainSnapshot(null, mcpPartial, ["mcp"]);
    expect(wipedIfStale.agents).toEqual([]);

    // Fixed path: re-read latest (afterCore) before merge.
    const afterMcp = applyPartialDomainSnapshotToLatest(afterCore, mcpPartial, ["mcp"]);
    expect(afterMcp.agents).toEqual(corePartial.agents);
    expect(afterMcp.mcp.total).toBe(3);
    expect(afterMcp.loadedDomains).toEqual(["core", "mcp"]);
  });

  it("re-read latest merge: late skills preserves agents and applies skillCount", () => {
    const afterCore = applyPartialDomainSnapshotToLatest(
      null,
      {
        generatedAt: 1,
        workspaceRoot: "/ws",
        agents: [{ id: "claude", provider: "claude", skillCount: 0 }],
        skills: [],
        providers: { total: 0, byAgent: {}, databasePath: "" },
        mcp: { total: 0, servers: [], generatedAt: 1, databasePath: "", apps: {}, countsByApp: {} },
        loadedDomains: ["core"],
      },
      ["core"],
    );
    const afterSkills = applyPartialDomainSnapshotToLatest(
      afterCore,
      {
        generatedAt: 2,
        workspaceRoot: "/ws",
        agents: [],
        skills: [{ name: "x", agents: ["claude"] }, { name: "y", agents: ["claude"] }],
        providers: { total: 0, byAgent: {}, databasePath: "" },
        mcp: { total: 0, servers: [], generatedAt: 2, databasePath: "", apps: {}, countsByApp: {} },
        loadedDomains: ["skills"],
      },
      ["skills"],
    );
    expect(afterSkills.agents).toHaveLength(1);
    expect(afterSkills.agents[0].skillCount).toBe(2);
    expect(afterSkills.skills).toHaveLength(2);
  });
});
