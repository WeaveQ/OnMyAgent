/**
 * localAgents domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "personalLocalAgentsList",
  "personalLocalAgentMetadataList",
  "personalLocalAgentAcpAgentsList",
  "personalLocalAgentAcpAgentsRefresh",
  "personalLocalAgentAcpHealth",
  "personalLocalAgentAcpSend",
  "personalLocalAgentAcpCancel",
  "personalLocalAgentAcpResolveApproval",
  "personalLocalAgentAcpConfigOptions",
  "personalLocalAgentSetAcpConfigOption",
  "personalLocalAgentCreateCustomAgent",
  "personalLocalAgentDetectAvailableAgents",
  "personalLocalAgentUpdateCustomAgent",
  "personalLocalAgentDeleteCustomAgent",
  "personalLocalAgentGetAgentOverrides",
  "personalLocalAgentSetAgentOverrides",
  "personalLocalAgentExtensionsList",
  "personalLocalAgentExtensionSetEnabled",
  "personalLocalAgentAcpProcessesList",
  "personalLocalAgentTestConnection",
  "personalLocalAgentTestCustomAgent",
  "personalLocalAgentCheckProviderHealth",
  "personalLocalAgentCheckManagedAgentHealthById",
  "personalLocalAgentValidate",
  "personalLocalAgentStart",
  "personalLocalAgentStatus",
  "personalLocalAgentRun",
  "personalLocalAgentCancel",
  "personalLocalAgentResolveApproval",
  "personalLocalAgentResetConversation",
  "personalLocalAgentConversationsList",
  "personalLocalAgentConversationGet",
  "personalLocalAgentConversationGetById",
  "personalLocalAgentChannelConversationsList",
  "personalLocalAgentConversationsListByProvider",
  "personalLocalAgentConversationImportFromArchive",
  "personalLocalAgentConversationCreate",
  "personalLocalAgentConversationStatus",
  "personalLocalAgentConversationWarmup",
  "personalLocalAgentProviderSessionsList",
  "personalLocalAgentProviderSessionLoad",
  "personalLocalAgentProviderSessionClose",
  "personalLocalAgentProviderSessionFork",
  "personalLocalAgentConversationConfirmationsList",
  "personalLocalAgentHostStatus",
  "personalLocalAgentConversationConfirmationConfirm",
  "personalLocalAgentNativeSessionsList",
  "personalLocalAgentConversationTranscript",
  "personalLocalAgentHeartbeatsList",
  "personalLocalAgentHeartbeatCreate",
  "personalLocalAgentHeartbeatUpdate",
  "personalLocalAgentHeartbeatDelete",
  "personalLocalAgentHeartbeatRunNow",
  "personalLocalAgentHeartbeatRuns",
  "localAgentComposerListFiles",
  "localAgentComposerSaveAttachment",
]);

const LOCAL_AGENT_MENTION_IGNORE = new Set([
  "node_modules", ".git", ".turbo", ".next", ".cache", "dist", "build",
  ".venv", "venv", "__pycache__", ".pnpm-store", ".output", "out",
  ".DS_Store", ".idea", ".vscode",
]);

async function localAgentComposerListFiles(input = {}) {
  const root = String(input.workspaceRoot ?? "").trim();
  if (!root) return { files: [] };
  const query = String(input.query ?? "").toLowerCase();
  const limit = Math.max(1, Math.min(Number(input.limit ?? 200), 500));
  const files = [];
  async function walk(dir, depth) {
    if (files.length >= limit || depth > 6) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (LOCAL_AGENT_MENTION_IGNORE.has(entry.name)) continue;
      }
      if (LOCAL_AGENT_MENTION_IGNORE.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) {
        if (!query || entry.name.toLowerCase().includes(query) || rel.toLowerCase().includes(query)) {
          files.push({ path: abs, relativePath: rel, name: entry.name, isDirectory: true });
        }
        await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        if (!query || entry.name.toLowerCase().includes(query) || rel.toLowerCase().includes(query)) {
          files.push({ path: abs, relativePath: rel, name: entry.name, isDirectory: false });
        }
      }
    }
  }
  await walk(root, 0);
  files.sort((a, b) => {
    if (query) {
      const aScore = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      const bScore = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      if (aScore !== bScore) return aScore - bScore;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
  return { files: files.slice(0, limit) };
}

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createLocalAgentsDomainHandlers({
  personalAgentRuntime,
  channelInfrastructureApi,
  personalAgentNativeSessions,
  personalAgentHeartbeatScheduler,
  scanAgentManagementSkills,
  app,
} = {}) {
  function localAgentAttachmentsDir(workspaceRoot) {
    const root = String(workspaceRoot ?? "").trim();
    const hash = createHash("sha1").update(root || "default").digest("hex").slice(0, 12);
    return path.join(app.getPath("userData"), "local-agent-attachments", hash);
  }

  async function localAgentComposerSaveAttachment(input = {}) {
    const root = String(input.workspaceRoot ?? "").trim();
    if (!root) throw new Error("workspaceRoot is required");
    const name = String(input.name ?? "attachment").replace(/[^\w.\-]+/g, "_") || "attachment";
    const dataUrl = String(input.dataUrl ?? "");
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("dataUrl must be base64 encoded");
    const buffer = Buffer.from(match[2], "base64");
    const dir = localAgentAttachmentsDir(root);
    await mkdir(dir, { recursive: true });
    const stamp = Date.now().toString(36) + randomBytes(3).toString("hex");
    const finalName = `${stamp}-${name}`;
    const absolute = path.join(dir, finalName);
    await writeFile(absolute, buffer);
    return { path: absolute, relativePath: absolute, name: finalName, size: buffer.length };
  }
  async function personalLocalAgentHostStatusWithManagementParity(input) {
    const fleetAgent = input?.agent ?? null;
    const [base, managed] = await Promise.all([
      personalAgentRuntime.getHostStatus(input),
      (async () => {
        const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
        if (!workspaceRoot) return [];
        try {
          return await scanAgentManagementSkills(workspaceRoot, {
            fleetAgents: fleetAgent ? [fleetAgent] : [],
          });
        } catch (error) {
          console.warn("[personalLocalAgentHostStatus] scanAgentManagementSkills failed", error);
          return [];
        }
      })(),
    ]);
    const provider = String(input?.agent?.provider ?? input?.agent?.id ?? "").toLowerCase();
    const id = String(input?.agent?.id ?? "").toLowerCase();
    const provKey = provider.includes("codex") ? "codex"
      : provider.includes("claude") ? "claude"
      : provider.includes("opencode") ? "opencode"
      : provider.includes("openclaw") ? "openclaw"
      : provider.includes("hermes") ? "hermes"
      : provider.includes("gemini") ? "gemini"
      : provider === "custom" ? id : (provider || id);
    const forProvider = managed.filter((skill) =>
      Array.isArray(skill.agents)
      && (skill.agents.includes(provKey) || (id && skill.agents.includes(id))),
    );
    const rootCounts = new Map();
    const skills = forProvider.map((skill) => {
      const indexFile = skill.path ? path.join(skill.path, "SKILL.md") : `runtime:${skill.name}`;
      const source = skill.root || skill.path || "";
      rootCounts.set(source, (rootCounts.get(source) ?? 0) + 1);
      return {
        id: skill.path ? path.basename(skill.path) : skill.name,
        name: skill.displayNameEn || skill.displayNameZh || skill.name,
        indexFile,
        source,
        provenance: "workspace",
      };
    });
    const roots = [...rootCounts.entries()].map(([p, count]) => ({ path: p, exists: true, count }));
    return {
      ...base,
      skill: {
        skills,
        roots,
        error: base?.skill?.error ?? null,
      },
    };
  }

  return {
  personalLocalAgentsList: async (event, args) => {
    const result = await personalAgentRuntime.listAgents(args[0] ?? {});
    const agents = Array.isArray(result?.agents) ? result.agents : [];
    return {
      ...result,
      agents: agents.filter((agent) => {
        if (String(agent?.provider ?? "") !== "custom") return true;
        return agent?.enabled !== false;
      }),
    };
  },

  personalLocalAgentMetadataList: async (event, args) => {
    return personalAgentRuntime.listAgentMetadata(args[0] ?? {});
  },

  personalLocalAgentAcpAgentsList: async (event, args) => {
    return personalAgentRuntime.listAcpAgents(args[0] ?? {});
  },

  personalLocalAgentAcpAgentsRefresh: async (event, args) => {
    return personalAgentRuntime.refreshAcpAgents(args[0] ?? {});
  },

  personalLocalAgentAcpHealth: async (event, args) => {
    return personalAgentRuntime.acpHealth(args[0] ?? {});
  },

  personalLocalAgentAcpSend: async (event, args) => {
    return personalAgentRuntime.acpSendMessage(args[0] ?? {});
  },

  personalLocalAgentAcpCancel: async (event, args) => {
    return personalAgentRuntime.acpCancel(args[0] ?? {});
  },

  personalLocalAgentAcpResolveApproval: async (event, args) => {
    return personalAgentRuntime.acpResolveApproval(args[0] ?? {});
  },

  personalLocalAgentAcpConfigOptions: async (event, args) => {
    return personalAgentRuntime.acpConfigOptions(args[0] ?? {});
  },

  personalLocalAgentSetAcpConfigOption: async (event, args) => {
    return personalAgentRuntime.setConfigOption(args[0] ?? {});
  },

  personalLocalAgentCreateCustomAgent: async (event, args) => {
    return personalAgentRuntime.createCustomAgent(args[0] ?? {});
  },

  personalLocalAgentDetectAvailableAgents: async (event, args) => {
    return personalAgentRuntime.detectAvailableLocalAgents(args[0] ?? {});
  },

  personalLocalAgentUpdateCustomAgent: async (event, args) => {
    return personalAgentRuntime.updateCustomAgent(args[0] ?? {});
  },

  personalLocalAgentDeleteCustomAgent: async (event, args) => {
    return personalAgentRuntime.deleteCustomAgent(args[0] ?? {});
  },

  personalLocalAgentGetAgentOverrides: async (event, args) => {
    return personalAgentRuntime.getAgentOverrides(args[0] ?? {});
  },

  personalLocalAgentSetAgentOverrides: async (event, args) => {
    return personalAgentRuntime.setAgentOverrides(args[0] ?? {});
  },

  personalLocalAgentExtensionsList: async (event, args) => {
    return personalAgentRuntime.listExtensions();
  },

  personalLocalAgentExtensionSetEnabled: async (event, args) => {
    return personalAgentRuntime.setExtensionEnabled(args[0] ?? {});
  },

  personalLocalAgentAcpProcessesList: async (event, args) => {
    return personalAgentRuntime.listProcesses(args[0] ?? {});
  },

  personalLocalAgentTestConnection: async (event, args) => {
    return personalAgentRuntime.testConnection(args[0] ?? {});
  },

  personalLocalAgentTestCustomAgent: async (event, args) => {
    return personalAgentRuntime.testCustomAgent(args[0] ?? {});
  },

  personalLocalAgentCheckProviderHealth: async (event, args) => {
    return personalAgentRuntime.checkProviderHealth(args[0] ?? {});
  },

  personalLocalAgentCheckManagedAgentHealthById: async (event, args) => {
    return personalAgentRuntime.checkManagedAgentHealthById(args[0] ?? {});
  },

  personalLocalAgentValidate: async (event, args) => {
    return personalAgentRuntime.validateAgent(args[0] ?? {});
  },

  personalLocalAgentStart: async (event, args) => {
    // Parity S4 (reverse relay): when Studio sends a message on a
    // conversation that is bound to an IM chat (source:"channel"), mirror
    // the user's prompt back to that chat. relayStudioMessage only acts on
    // conversations actually bound to a channel session, so studio-created
    // conversations are unaffected. IM-originated messages never pass
    // through this IPC handler (the channel service calls the runtime
    // in-process), so there is no echo risk.
    const result = await personalAgentRuntime.startMessage(args[0] ?? {});
    const relayConversationId = result?.conversationId ?? null;
    const relayPrompt = String(args[0]?.prompt ?? "").trim();
    if (relayConversationId && relayPrompt) {
      channelInfrastructureApi.relayStudioMessage(relayConversationId, relayPrompt);
    }
    return result;
  },

  personalLocalAgentStatus: async (event, args) => {
    return personalAgentRuntime.getRun(args[0]);
  },

  personalLocalAgentRun: async (event, args) => {
    // Same reverse-relay behavior as personalLocalAgentStart for Studio
    // clients that use the run (fire-and-poll) entry point directly.
    const result = await personalAgentRuntime.runMessage(args[0] ?? {});
    const relayConversationId = result?.conversationId ?? null;
    const relayPrompt = String(args[0]?.prompt ?? "").trim();
    if (relayConversationId && relayPrompt) {
      channelInfrastructureApi.relayStudioMessage(relayConversationId, relayPrompt);
    }
    return result;
  },

  personalLocalAgentCancel: async (event, args) => {
    return personalAgentRuntime.cancelRun(args[0]);
  },

  personalLocalAgentResolveApproval: async (event, args) => {
    return personalAgentRuntime.resolveApproval(args[0] ?? {});
  },

  personalLocalAgentResetConversation: async (event, args) => {
    return personalAgentRuntime.resetConversation(args[0] ?? {});
  },

  personalLocalAgentConversationsList: async (event, args) => {
    return personalAgentRuntime.listConversations(args[0] ?? {});
  },

  personalLocalAgentConversationGet: async (event, args) => {
    return personalAgentRuntime.getConversation(args[0] ?? {});
  },

  personalLocalAgentConversationGetById: async (event, args) => {
    return personalAgentRuntime.getConversationById(args[0] ?? {});
  },

  personalLocalAgentChannelConversationsList: async (event, args) => {
    return personalAgentRuntime.listChannelConversations(args[0] ?? {});
  },

  personalLocalAgentConversationsListByProvider: async (event, args) => {
    return personalAgentRuntime.listConversationsByProvider(args[0] ?? {});
  },

  personalLocalAgentConversationImportFromArchive: async (event, args) => {
    return personalAgentRuntime.importConversationFromArchive(args[0] ?? {});
  },

  personalLocalAgentConversationCreate: async (event, args) => {
    return personalAgentRuntime.createConversation(args[0] ?? {});
  },

  personalLocalAgentConversationStatus: async (event, args) => {
    return personalAgentRuntime.getConversationStatus(args[0] ?? {});
  },

  personalLocalAgentConversationWarmup: async (event, args) => {
    return personalAgentRuntime.warmupConversation(args[0] ?? {});
  },

  personalLocalAgentProviderSessionsList: async (event, args) => {
    return personalAgentRuntime.listProviderSessions(args[0] ?? {});
  },

  personalLocalAgentProviderSessionLoad: async (event, args) => {
    return personalAgentRuntime.loadProviderSession(args[0] ?? {});
  },

  personalLocalAgentProviderSessionClose: async (event, args) => {
    return personalAgentRuntime.closeProviderSession(args[0] ?? {});
  },

  personalLocalAgentProviderSessionFork: async (event, args) => {
    return personalAgentRuntime.forkProviderSession(args[0] ?? {});
  },

  personalLocalAgentConversationConfirmationsList: async (event, args) => {
    return personalAgentRuntime.listConversationConfirmations(args[0] ?? {});
  },

  personalLocalAgentHostStatus: async (event, args) => {
    return personalLocalAgentHostStatusWithManagementParity(args[0] ?? {});
  },

  personalLocalAgentConversationConfirmationConfirm: async (event, args) => {
    return personalAgentRuntime.confirmConversationConfirmation(args[0] ?? {});
  },

  personalLocalAgentNativeSessionsList: async (event, args) => {
    return personalAgentNativeSessions.listNativeSessions(args[0] ?? {});
  },

  personalLocalAgentConversationTranscript: async (event, args) => {
    return personalAgentNativeSessions.loadConversationTranscript(args[0] ?? {});
  },

  personalLocalAgentHeartbeatsList: async (event, args) => {
    return personalAgentHeartbeatScheduler.list(args[0] ?? {});
  },

  personalLocalAgentHeartbeatCreate: async (event, args) => {
    return personalAgentHeartbeatScheduler.create(args[0] ?? {});
  },

  personalLocalAgentHeartbeatUpdate: async (event, args) => {
    return personalAgentHeartbeatScheduler.update(args[0] ?? {});
  },

  personalLocalAgentHeartbeatDelete: async (event, args) => {
    return personalAgentHeartbeatScheduler.delete(args[0] ?? {});
  },

  personalLocalAgentHeartbeatRunNow: async (event, args) => {
    return personalAgentHeartbeatScheduler.runNow(args[0] ?? {});
  },

  personalLocalAgentHeartbeatRuns: async (event, args) => {
    return personalAgentHeartbeatScheduler.runs(args[0] ?? {});
  },

  localAgentComposerListFiles: async (event, args) => {
    return localAgentComposerListFiles(args[0] ?? {});
  },

  localAgentComposerSaveAttachment: async (event, args) => {
    return localAgentComposerSaveAttachment(args[0] ?? {});
  },

  };
}
