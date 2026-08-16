/**
 * Conversation-facing API for createPersonalAgentRuntime.
 * Thin wrappers around conversation-store + session-store — extracted so
 * index.mjs stays a composition root for runs/adapters/health.
 */

import { runEventsToConversationMessages } from "./contract.mjs";
import {
  createConversation,
  getConversation,
  getConversationById,
  importConversationFromArchive,
  listChannelConversations,
  listConversations,
  listConversationsByProvider,
  readConversationEvents,
  resetConversationPointer,
} from "./conversation-store.mjs";
import { clearSession } from "./session-store.mjs";

/**
 * @param {{
 *   legacy: { normalizeAgent: (agent: unknown) => Promise<any> },
 *   runs: Map<string, any>,
 *   getRunSnapshot: (state: any, options?: any) => any,
 *   resolveApproval: (input: any) => Promise<any> | any,
 * }} deps
 */
export function createConversationRuntimeApi({
  legacy,
  runs,
  getRunSnapshot,
  resolveApproval,
}) {
  async function resetConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    for (const state of runs.values()) {
      if (
        state.status === "running" &&
        state.workspaceRoot === workspaceRoot &&
        state.agentProvider === agent.provider &&
        state.agentId === agent.id
      ) {
        return { ok: false, error: "agent has an active run" };
      }
    }
    const conversation = await resetConversationPointer(workspaceRoot, agent.provider, agent.id, input.conversationId);
    const cleared = await clearSession(workspaceRoot, agent.provider, agent.id);
    return { ...cleared, conversation };
  }

  async function listAgentConversations(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return listConversations(workspaceRoot, agent.provider, agent.id);
  }

  async function createAgentConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const conversation = await createConversation(workspaceRoot, agent.provider, agent.id, input);
    return { conversation };
  }

  async function getAgentConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const conversation = await getConversation(workspaceRoot, agent.provider, agent.id, input.conversationId);
    return { conversation };
  }

  // Cross-agent lookup by id (ignores the provider/agentId partition).
  async function getAgentConversationById(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const conversationId = String(input.conversationId ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!conversationId) throw new Error("conversationId is required");
    const conversation = await getConversationById(workspaceRoot, conversationId);
    return { conversation };
  }

  async function listAgentChannelConversations(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return listChannelConversations(workspaceRoot);
  }

  async function listAgentConversationsByProvider(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return listConversationsByProvider(workspaceRoot, agent.provider, agent.id);
  }

  async function importAgentConversationFromArchive(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return importConversationFromArchive(workspaceRoot, agent.provider, agent.id, input);
  }

  async function getConversationStatus(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const conversation = await getConversation(workspaceRoot, agent.provider, agent.id, input.conversationId);
    const activeRun = [...runs.values()].find((state) => (
      state.workspaceRoot === workspaceRoot
      && state.agentProvider === agent.provider
      && state.agentId === agent.id
      && (!conversation?.id || state.conversationId === conversation.id)
      && state.status === "running"
    ));
    if (activeRun?.lastApprovalPersist) {
      await activeRun.lastApprovalPersist.catch(() => undefined);
    }
    const persisted = conversation?.id
      ? await readConversationEvents(workspaceRoot, agent.provider, agent.id, conversation.id)
      : { events: [], messages: [] };
    return {
      conversation,
      activeRun: activeRun ? getRunSnapshot(activeRun) : null,
      running: Boolean(activeRun),
      status: activeRun?.status ?? conversation?.lastStatus ?? "idle",
      events: activeRun ? activeRun.events : persisted.events,
      conversationMessages: activeRun
        ? runEventsToConversationMessages(activeRun.events)
        : (Array.isArray(persisted.events) && persisted.events.length
          ? runEventsToConversationMessages(persisted.events)
          : persisted.messages),
    };
  }

  async function listConversationConfirmations(input = {}) {
    const statusResult = await getConversationStatus(input);
    const confirmations = statusResult.activeRun?.pendingApprovals ?? statusResult.conversationMessages
      .filter((message) => message.type === "permission" && message.approval)
      .map((message) => message.approval);
    return {
      conversation: statusResult.conversation,
      confirmations,
    };
  }

  async function confirmConversationConfirmation(input = {}) {
    const runIdValue = String(input.runId ?? "").trim();
    if (runIdValue) return resolveApproval(input);
    const statusResult = await getConversationStatus(input);
    const approvalId = String(input.approvalId ?? input.id ?? "").trim();
    const approval = (statusResult.activeRun?.pendingApprovals ?? []).find((item) => item.id === approvalId);
    if (!statusResult.activeRun?.runId || !approval) return { ok: false, error: "approval request not found" };
    return resolveApproval({ ...input, runId: statusResult.activeRun.runId, approvalId });
  }

  return {
    resetConversation,
    listAgentConversations,
    createAgentConversation,
    getAgentConversation,
    getAgentConversationById,
    listAgentChannelConversations,
    listAgentConversationsByProvider,
    importAgentConversationFromArchive,
    getConversationStatus,
    listConversationConfirmations,
    confirmConversationConfirmation,
  };
}

/**
 * Pure probe-metadata extraction from health/warmup payloads.
 * @param {...unknown} sources
 */
export function extractProbeMetadata(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    /** @type {Record<string, any>} */
    const root = /** @type {Record<string, any>} */ (source);
    const modelsBlock =
      root.models && typeof root.models === "object"
        ? /** @type {Record<string, any>} */ (root.models)
        : root;
    const rawModels = Array.isArray(modelsBlock.availableModels)
      ? modelsBlock.availableModels
      : Array.isArray(root.availableModels)
        ? root.availableModels
        : Array.isArray(root.available_models)
          ? root.available_models
          : [];
    const models = rawModels
      .map((item) => (item && typeof item === "object"
        ? { id: String(item.id ?? item.modelId ?? item.name ?? "").trim(), label: String(item.name ?? item.label ?? item.id ?? "").trim() }
        : { id: String(item ?? "").trim(), label: String(item ?? "").trim() }))
      .filter((m) => m.id);
    const configOptions = Array.isArray(root.configOptions)
      ? root.configOptions
      : Array.isArray(root.config_options)
        ? root.config_options
        : [];
    if (models.length || configOptions.length) return { models, configOptions };
  }
  return { models: [], configOptions: [] };
}
