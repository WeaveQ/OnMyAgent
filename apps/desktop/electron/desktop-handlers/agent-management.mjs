/**
 * agentManagement domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 *
 * Snapshot supports domain-selective loads so the agents (本地) first paint
 * does not block on skill directory scan or MCP inventory.
 */

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

const ALL_DOMAINS = Object.freeze(["core", "skills", "mcp", "providers"]);

/**
 * @param {unknown} input
 * @returns {null | Array<"core"|"skills"|"mcp"|"providers">}
 */
function normalizeDomains(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out = [];
  for (const item of input) {
    if (
      (item === "core" || item === "skills" || item === "mcp" || item === "providers") &&
      !out.includes(item)
    ) {
      out.push(item);
    }
  }
  return out.length > 0 ? out : null;
}

function emptyProvidersSnapshot() {
  return {
    databasePath: "",
    total: 0,
    byAgent: {
      opencode: [],
      codex: [],
      claude: [],
      openclaw: [],
      hermes: [],
    },
  };
}

function emptyMcpSnapshot() {
  return {
    generatedAt: Date.now(),
    databasePath: "",
    apps: {},
    servers: [],
    total: 0,
    countsByApp: {},
  };
}

/**
 * @param {Array<any>} managedSkills
 * @returns {Map<string, number>}
 */
function buildSkillCountMap(managedSkills) {
  const skillCounts = new Map();
  for (const skill of managedSkills) {
    for (const agent of skill.agents ?? []) {
      skillCounts.set(agent, (skillCounts.get(agent) ?? 0) + 1);
    }
  }
  return skillCounts;
}

/**
 * @param {any[]} agents
 * @param {Map<string, any>} usageByProvider
 * @param {Map<string, number>} skillCounts
 * @param {{ emptyAgentUsageSummary: () => any }} personalAgentLegacyHarness
 */
function mapAgentsWithUsageAndSkills(agents, usageByProvider, skillCounts, personalAgentLegacyHarness) {
  return agents.map((agent) => {
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
  });
}

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
  /**
   * @param {{
   *   workspaceRoot?: string,
   *   domains?: Array<"core"|"skills"|"mcp"|"providers">,
   *   includeModels?: boolean,
   *   includeDiscoverable?: boolean,
   * }} [input]
   */
  async function agentManagementSnapshot(input = {}) {
    const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");

    const domains = normalizeDomains(input.domains);
    // Omitted domains → full legacy snapshot (settings + older clients).
    const wantCore = !domains || domains.includes("core");
    const wantSkills = !domains || domains.includes("skills");
    const wantMcp = !domains || domains.includes("mcp");
    // Settings AI custom-provider inventory: providers only, no fleet agent scan.
    const wantProvidersOnly = Boolean(domains?.includes("providers")) && !wantCore;

    // Domain-aware clients default to light listAgents (no model probe).
    // Legacy full snapshot keeps includeModels true unless explicitly false.
    const includeModels = domains
      ? input.includeModels === true
      : input.includeModels !== false;
    const includeDiscoverable = input.includeDiscoverable !== false;

    /** @type {any[]} */
    let agents = [];
    /** @type {Map<string, any>} */
    let usageByProvider = new Map();
    let providers = emptyProvidersSnapshot();
    let mcp = emptyMcpSnapshot();
    /** @type {any[]} */
    let managedSkills = [];
    /** @type {Array<"core"|"skills"|"mcp"|"providers">} */
    const loadedDomains = [];

    if (wantProvidersOnly) {
      providers = await readAgentManagementProvidersSnapshot();
      loadedDomains.push("providers");
    }

    // Skills need fleetAgents; listAgents is required for core and/or skills.
    if (wantCore || wantSkills) {
      if (wantCore) {
        const [listed, usage, prov] = await Promise.all([
          personalAgentRuntime.listAgents({
            workspaceRoot,
            includeModels,
            includeDiscoverable,
          }),
          personalAgentLegacyHarness.readPersonalAgentUsageSummary(workspaceRoot),
          readAgentManagementProvidersSnapshot(),
        ]);
        agents = listed.agents ?? [];
        usageByProvider = usage;
        providers = prov;
        loadedDomains.push("core");
      } else {
        // skills-only: still need a light agent list for inventory scope.
        const listed = await personalAgentRuntime.listAgents({
          workspaceRoot,
          includeModels: false,
          includeDiscoverable: true,
        });
        agents = listed.agents ?? [];
      }
    }

    // Skills + MCP are independent once agents (if needed) are ready; run in parallel when both wanted.
    if (wantSkills && wantMcp) {
      const [skillsResult, mcpResult] = await Promise.all([
        scanAgentManagementSkills(workspaceRoot, { fleetAgents: agents }),
        agentManagementMcpSnapshot(),
      ]);
      managedSkills = skillsResult;
      mcp = mcpResult;
      loadedDomains.push("skills", "mcp");
    } else if (wantSkills) {
      managedSkills = await scanAgentManagementSkills(workspaceRoot, { fleetAgents: agents });
      loadedDomains.push("skills");
    } else if (wantMcp) {
      mcp = await agentManagementMcpSnapshot();
      loadedDomains.push("mcp");
    }

    const skillCounts = buildSkillCountMap(managedSkills);
    const mappedAgents = wantCore
      ? mapAgentsWithUsageAndSkills(
          agents,
          usageByProvider,
          skillCounts,
          personalAgentLegacyHarness,
        )
      : [];

    return {
      generatedAt: Date.now(),
      workspaceRoot,
      agents: mappedAgents,
      skills: wantSkills ? managedSkills : [],
      providers,
      mcp,
      loadedDomains: domains ? loadedDomains : [...ALL_DOMAINS],
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
