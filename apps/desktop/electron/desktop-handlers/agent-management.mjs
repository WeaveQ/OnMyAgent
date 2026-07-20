/**
 * agentManagement domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

import path from "node:path";

import {
  agentManagementMcpSnapshot,
  deleteMcpServerAction,
  importMcpFromApps,
  toggleMcpServerApp,
  upsertMcpServer,
} from "../agent-management-mcp.mjs";

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "agentManagementSnapshot",
  "agentManagementProviderAction",
  "agentManagementFetchModels",
  "agentManagementSkillAction",
  "agentManagementMcpSnapshot",
  "agentManagementMcpAction",
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createAgentManagementDomainHandlers({
  personalAgentRuntime,
  personalAgentLegacyHarness,
  scanAgentManagementSkills,
  agentManagementProviderAction,
  agentManagementFetchModels,
  agentManagementSkillAction,
  readAgentManagementProvidersSnapshot,
} = {}) {
  async function agentManagementSnapshot(input = {}) {
    const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    // Agents first so skill inventory can scan each managed agent's
    // nativeSkillsDirs (catalog agents like WorkBuddy are not in the fixed product set).
    const [{ agents }, usageByProvider, providers, mcp] = await Promise.all([
      personalAgentRuntime.listAgents({ workspaceRoot, includeModels: true, includeDiscoverable: true }),
      personalAgentLegacyHarness.readPersonalAgentUsageSummary(workspaceRoot),
      readAgentManagementProvidersSnapshot(),
      agentManagementMcpSnapshot(),
    ]);
    const managedSkills = await scanAgentManagementSkills(workspaceRoot, { fleetAgents: agents });
    const skillCounts = new Map();
    for (const skill of managedSkills) {
      for (const agent of skill.agents) {
        skillCounts.set(agent, (skillCounts.get(agent) ?? 0) + 1);
      }
    }
    return {
      generatedAt: Date.now(),
      workspaceRoot,
      agents: agents.map((agent) => {
        // Custom agents share the literal provider "custom", so we must NOT key
        // their lookup by provider (that would hit the empty pre-seeded "custom"
        // bucket and hide their real stats). Their run logs are keyed by agentId
        // == agent.id. Built-in providers are keyed by provider directly.
        const usageKey = agent.provider === "custom" ? agent.id : agent.provider;
        const skillKey =
          agent.provider === "custom"
            ? String(agent.id ?? "").toLowerCase()
            : String(agent.provider ?? "").toLowerCase();
        const skillCount =
          skillCounts.get(skillKey)
          ?? skillCounts.get(String(agent.id ?? "").toLowerCase())
          ?? skillCounts.get(String(agent.provider ?? "").toLowerCase())
          ?? 0;
        return {
          ...agent,
          usage: usageByProvider.get(usageKey) ?? personalAgentLegacyHarness.emptyAgentUsageSummary(),
          skillCount,
        };
      }),
      skills: managedSkills,
      providers,
      mcp,
    };
  }

  return {
  agentManagementSnapshot: async (event, args) => {
    return agentManagementSnapshot(args[0] ?? {});
  },

  agentManagementProviderAction: async (event, args) => {
    return agentManagementProviderAction(args[0] ?? {});
  },

  agentManagementFetchModels: async (event, args) => {
    return agentManagementFetchModels(args[0] ?? {});
  },

  agentManagementSkillAction: async (event, args) => {
    return agentManagementSkillAction(args[0] ?? {});
  },

  agentManagementMcpSnapshot: async (event, args) => {
    return agentManagementMcpSnapshot();
  },

  agentManagementMcpAction: async (event, args) => {
    const input = args[0] ?? {};
    const action = String(input.action ?? "").trim();
    if (action === "import") return importMcpFromApps(input);
    if (action === "save") return upsertMcpServer(input.server ?? input);
    if (action === "delete") return deleteMcpServerAction(input);
    if (action === "toggle") return toggleMcpServerApp(input);
    throw new Error(`Unsupported MCP action: ${action}`);
  },

  };
}
