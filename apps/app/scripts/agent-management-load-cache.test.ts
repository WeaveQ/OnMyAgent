import { describe, expect, it } from "bun:test";

import {
  applySkillCountsToAgents,
  coreReadyForAgentsPanel,
  DEFAULT_MANAGEMENT_DOMAIN_TTL_MS,
  domainsForAgentMutation,
  domainsForPanel,
  domainsForSkillMutation,
  isDomainFresh,
  markDomainsFetched,
  mergeManagementDomainSnapshot,
  missingDomains,
  normalizeManagementDomains,
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
});
