/**
 * localAgents domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES } from "@onmyagent/types/desktop-ipc";

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

export const LOCAL_AGENT_ATTACHMENT_MAX_FILES = 64;
export const LOCAL_AGENT_ATTACHMENT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const LOCAL_AGENT_ATTACHMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOCAL_AGENT_ATTACHMENT_MAX_DATA_URL_CHARS = Math.ceil(LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES / 3) * 4 + 256;

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
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
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
  resolveLocalAgentBrowserMcpServer,
  app,
} = {}) {
  const attachmentWriteQueues = new Map();

  function localAgentAttachmentsDir(workspaceRoot) {
    const root = String(workspaceRoot ?? "").trim();
    const hash = createHash("sha1").update(root || "default").digest("hex").slice(0, 12);
    return path.join(app.getPath("userData"), "local-agent-attachments", hash);
  }

  async function pruneLocalAgentAttachments(dir, incomingBytes) {
    const now = Date.now();
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = (await Promise.all(entries.flatMap((entry) => {
      if (!entry.isFile()) return [];
      const absolute = path.join(dir, entry.name);
      return [stat(absolute)
        .then((info) => ({ absolute, size: info.size, modifiedAt: info.mtimeMs }))
        .catch(() => null)];
    }))).filter(Boolean);
    const retained = [];
    for (const file of files) {
      if (now - file.modifiedAt > LOCAL_AGENT_ATTACHMENT_MAX_AGE_MS) {
        await unlink(file.absolute).catch(() => undefined);
      } else {
        retained.push(file);
      }
    }
    retained.sort((left, right) => left.modifiedAt - right.modifiedAt);
    let totalBytes = retained.reduce((total, file) => total + file.size, 0);
    while (
      retained.length >= LOCAL_AGENT_ATTACHMENT_MAX_FILES
      || totalBytes + incomingBytes > LOCAL_AGENT_ATTACHMENT_MAX_TOTAL_BYTES
    ) {
      const oldest = retained.shift();
      if (!oldest) break;
      await unlink(oldest.absolute).catch(() => undefined);
      totalBytes -= oldest.size;
    }
  }

  async function localAgentComposerSaveAttachment(input = {}) {
    const root = String(input.workspaceRoot ?? "").trim();
    if (!root) throw new Error("workspaceRoot is required");
    const name = (String(input.name ?? "attachment").replace(/[^\w.\-]+/g, "_") || "attachment").slice(-160);
    const dataUrl = String(input.dataUrl ?? "");
    if (dataUrl.length > LOCAL_AGENT_ATTACHMENT_MAX_DATA_URL_CHARS) {
      throw new Error(`attachment exceeds ${LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES} bytes`);
    }
    const declaredSize = Number(input.size);
    if (Number.isFinite(declaredSize) && declaredSize > LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES) {
      throw new Error(`attachment exceeds ${LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES} bytes`);
    }
    const match = /^data:([^;,\s]+);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(dataUrl);
    if (!match) throw new Error("dataUrl must be base64 encoded");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES) {
      throw new Error(`attachment exceeds ${LOCAL_AGENT_COMPOSER_ATTACHMENT_MAX_BYTES} bytes`);
    }
    if (Number.isFinite(declaredSize) && declaredSize >= 0 && declaredSize !== buffer.length) {
      throw new Error("attachment size does not match payload");
    }
    const dir = localAgentAttachmentsDir(root);
    await mkdir(dir, { recursive: true });
    const previous = attachmentWriteQueues.get(dir) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      await pruneLocalAgentAttachments(dir, buffer.length);
      const stamp = Date.now().toString(36) + randomBytes(3).toString("hex");
      const finalName = `${stamp}-${name}`;
      const absolute = path.join(dir, finalName);
      await writeFile(absolute, buffer, { flag: "wx" });
      return { path: absolute, relativePath: absolute, name: finalName, size: buffer.length };
    });
    attachmentWriteQueues.set(dir, operation);
    try {
      return await operation;
    } finally {
      if (attachmentWriteQueues.get(dir) === operation) attachmentWriteQueues.delete(dir);
    }
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

  function relayStudioPrompt(result, input) {
    const conversationId = String(result?.conversationId ?? "").trim();
    const prompt = String(input?.prompt ?? "").trim();
    if (!conversationId || !prompt || typeof channelInfrastructureApi?.relayStudioMessage !== "function") return;
    void Promise.resolve(channelInfrastructureApi.relayStudioMessage(conversationId, prompt)).catch(() => undefined);
  }

  // One application-service owner for every Personal start/cancel/approval IPC
  // spelling. Compatibility commands delegate here so relay and input
  // normalization cannot drift between ACP and legacy callers.
  async function withLocalAgentBrowserMcp(input = {}) {
    if (typeof resolveLocalAgentBrowserMcpServer !== "function") return input;
    const browserServer = await resolveLocalAgentBrowserMcpServer(input);
    if (!browserServer) return input;
    const currentServers = Array.isArray(input.mcpServers) ? input.mcpServers : [];
    const withoutStaleBrowser = currentServers.filter(
      (server) => server?.name !== browserServer.name,
    );
    return {
      ...input,
      mcpServers: [...withoutStaleBrowser, browserServer],
    };
  }

  const personalMessageService = {
    async start(input = {}) {
      const resolvedInput = await withLocalAgentBrowserMcp(input);
      const result = await personalAgentRuntime.startMessage(resolvedInput);
      relayStudioPrompt(result, input);
      return result;
    },
    async run(input = {}) {
      const resolvedInput = await withLocalAgentBrowserMcp(input);
      const result = await personalAgentRuntime.runMessage(resolvedInput);
      relayStudioPrompt(result, input);
      return result;
    },
    cancel(input) {
      return personalAgentRuntime.cancelRun(input?.runId ?? input?.id ?? input);
    },
    resolveApproval(input = {}) {
      return personalAgentRuntime.resolveApproval(input);
    },
  };

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
    return personalMessageService.start(args[0] ?? {});
  },

  personalLocalAgentAcpCancel: async (event, args) => {
    return personalMessageService.cancel(args[0]);
  },

  personalLocalAgentAcpResolveApproval: async (event, args) => {
    return personalMessageService.resolveApproval(args[0] ?? {});
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
    return personalMessageService.start(args[0] ?? {});
  },

  personalLocalAgentStatus: async (event, args) => {
    // Terminal runs expose the complete transcript. While a run is active,
    // polling keeps the prompt plus a recent transcript/event tail so repeated
    // 1.5s IPC round-trips cannot grow without bound.
    return personalAgentRuntime.getRun(args[0], {
      eventLimit: 200,
      conversationMessageEventLimit: 200,
    });
  },

  personalLocalAgentRun: async (event, args) => {
    return personalMessageService.run(args[0] ?? {});
  },

  personalLocalAgentCancel: async (event, args) => {
    return personalMessageService.cancel(args[0]);
  },

  personalLocalAgentResolveApproval: async (event, args) => {
    return personalMessageService.resolveApproval(args[0] ?? {});
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
