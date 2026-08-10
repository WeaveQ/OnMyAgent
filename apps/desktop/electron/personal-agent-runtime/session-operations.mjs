// Provider-session operations for the personal-agent runtime.
//
// Owns warmupConversation, provider session list/load/close/fork, and the
// ACP setConfigOption path. These share the adapter factory and conversation
// stores; the runtime passes in the closure-bound collaborators.

import { ensureManagedAcpTool } from "./managed-acp-tools.mjs";
import { readSession, writeSession } from "./session-store.mjs";
import { writeAgentHandshakeCache } from "./agent-handshake-cache.mjs";
import {
  createConversation,
  getOrCreateConversation,
  listConversations,
  updateConversation,
  writeConversationEvents,
} from "./conversation-store.mjs";
import { normalizeAccessibleWorkspaceRoots } from "./artifact-tracking.mjs";
import {
  defaultConnectionMode,
  normalizeApprovalMode,
} from "./run-helpers.mjs";

/**
 * @param {object} deps
 * @param {object} deps.legacy
 * @param {Record<string, unknown>} deps.injectedAdapters
 * @param {(provider: string, agent?: object) => Function|null} deps.adapterFactoryForProvider
 * @param {Map<string, object>} deps.runs
 * @param {(id: string, options?: object) => Promise<object>} deps.cancel
 */
export function createSessionOperations(deps) {
  const {
    legacy,
    injectedAdapters,
    adapterFactoryForProvider,
    runs,
    cancel,
  } = deps;

  async function warmupConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const detected = await legacy.detectAgent(agent, workspaceRoot);
    const provider = detected.provider ?? agent.provider;
    const agentId = detected.id ?? agent.id ?? provider;
    const adapterFactory = adapterFactoryForProvider(provider, detected);
    if (!adapterFactory) return { ok: false, unsupportedReason: "adapter_not_supported" };
    if (detected.status !== "online") return { ok: false, error: detected.error || `${detected.name ?? provider} is not online` };
    if ((provider === "codex" || provider === "claude") && !Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) {
      const tool = await ensureManagedAcpTool(provider);
      detected.executablePath = tool.binPath;
      detected.managedAcpTool = tool;
      detected.connectionMode = defaultConnectionMode(provider, detected);
    }
    const conversation = await getOrCreateConversation(workspaceRoot, provider, agentId, input.conversationId);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.warmupConversation !== "function") return { ok: false, conversation, unsupportedReason: "warmup_not_supported" };
    try {
      const warmed = await adapter.warmupConversation({
        runId: `warmup-${Date.now()}`,
        workspaceRoot,
        accessibleWorkspaceRoots: normalizeAccessibleWorkspaceRoots(input.accessibleWorkspaceRoots, workspaceRoot),
        conversationId: conversation.id,
        providerSessionId: conversation.providerSessionId,
        resumeKey: conversation.resumeKey,
        conversationWorkdir: conversation.workdir,
        agent: detected,
        model: input.model ?? detected.model,
        approvalMode: normalizeApprovalMode(input.approvalMode),
      });
      const warmSessionMetadata = warmed.sessionMetadata && typeof warmed.sessionMetadata === "object"
        ? warmed.sessionMetadata
        : null;
      if (warmSessionMetadata) {
        try {
          const priorSession = await readSession(workspaceRoot, provider, agentId).catch(() => ({}));
          await writeSession(workspaceRoot, provider, agentId, {
            ...(priorSession && typeof priorSession === "object" ? priorSession : {}),
            sessionId: warmed.sessionId ?? warmed.providerSessionId ?? priorSession?.sessionId ?? "",
            workdir: warmed.workdir ?? priorSession?.workdir ?? conversation.workdir ?? null,
            sessionMetadata: warmSessionMetadata,
            handshakeAt: Date.now(),
          });
          // Mirror under the original (stored) provider key for custom agents.
          const originalProvider = String(input.agent?.provider ?? agent.provider ?? "").trim();
          if (originalProvider && originalProvider !== provider) {
            try {
              const priorOriginal = await readSession(workspaceRoot, originalProvider, agentId).catch(() => ({}));
              await writeSession(workspaceRoot, originalProvider, agentId, {
                ...(priorOriginal && typeof priorOriginal === "object" ? priorOriginal : {}),
                sessionMetadata: warmSessionMetadata,
                handshakeAt: Date.now(),
              });
            } catch {
              // best-effort mirror
            }
          }
          const cacheProvider = originalProvider || provider;
          await writeAgentHandshakeCache(cacheProvider, agentId, {
            sessionMetadata: warmSessionMetadata,
            handshakeAt: Date.now(),
          }).catch(() => undefined);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(`[personal-agent-runtime] warmup session-store write failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const updated = await updateConversation(workspaceRoot, provider, agentId, conversation.id, {
        providerSessionId: warmed.providerSessionId ?? warmed.sessionId ?? conversation.providerSessionId,
        resumeKey: warmed.resumeKey ?? warmed.providerSessionId ?? warmed.sessionId ?? conversation.resumeKey,
        workdir: warmed.workdir ?? conversation.workdir,
        metadata: { ...(conversation.metadata ?? {}), warmupAt: Date.now(), warmupStatus: "ready", sessionMetadata: warmSessionMetadata },
      });
      return { ok: true, conversation: updated, providerSessionId: updated.providerSessionId, resumeKey: updated.resumeKey };
    } catch (error) {
      return { ok: false, conversation, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function noopAdapter() {
    return { appendEvent: () => undefined, registerCancel: () => undefined };
  }

  async function listAgentProviderSessions(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory(noopAdapter());
    if (typeof adapter.listSessions !== "function") return { sessions: [], unsupportedReason: "session_list_not_supported" };
    return adapter.listSessions({ ...input, workspaceRoot, agent });
  }

  async function loadAgentProviderSession(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory(noopAdapter());
    if (typeof adapter.loadSession !== "function") throw new Error(`${agent.provider} does not support session/load`);
    const loaded = await adapter.loadSession({ ...input, workspaceRoot, agent });
    const sessionId = loaded.sessionId || input.providerSessionId || input.resumeKey;
    let conversation = null;
    if (sessionId) {
      const listed = await listConversations(workspaceRoot, agent.provider, agent.id);
      conversation = listed.conversations.find(
        (item) => item.providerSessionId === sessionId || item.resumeKey === sessionId,
      ) ?? null;
    }
    if (!conversation) {
      conversation = await createConversation(workspaceRoot, agent.provider, agent.id, {
        title: input.title ?? `Loaded ${loaded.sessionId}`,
        providerSessionId: loaded.sessionId,
        resumeKey: loaded.sessionId,
        source: "provider-session-load",
        metadata: loaded.raw ?? null,
      });
    }
    if (Array.isArray(loaded.conversationMessages) && loaded.conversationMessages.length) {
      await writeConversationEvents(workspaceRoot, agent.provider, agent.id, conversation.id, [], loaded.conversationMessages);
    }
    return { ...loaded, conversation };
  }

  async function closeAgentProviderSession(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const sessionId = String(input.sessionId ?? input.providerSessionId ?? input.resumeKey ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!sessionId) throw new Error("sessionId is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory(noopAdapter());
    if (typeof adapter.closeSession !== "function") throw new Error(`${agent.provider} does not support session/close`);
    const result = await adapter.closeSession({ ...input, sessionId, workspaceRoot, agent });
    const listed = await listConversations(workspaceRoot, agent.provider, agent.id);
    const closedConversations = listed.conversations.filter((conversation) => {
      if (input.conversationId && conversation.id === input.conversationId) return true;
      return conversation.providerSessionId === sessionId || conversation.resumeKey === sessionId;
    });
    for (const conversation of closedConversations) {
      await updateConversation(workspaceRoot, agent.provider, agent.id, conversation.id, {
        providerSessionId: null,
        resumeKey: null,
        lastStatus: "closed",
        metadata: {
          ...(conversation.metadata ?? {}),
          closedProviderSessionId: sessionId,
          closedAt: Date.now(),
        },
      });
      for (const state of runs.values()) {
        if (state.workspaceRoot === workspaceRoot && state.agentProvider === agent.provider && state.agentId === agent.id && state.conversationId === conversation.id && state.status === "running") {
          await cancel(state.runId, { reason: "provider-session-closed" }).catch(() => undefined);
        }
      }
    }
    return { ...result, closedConversationIds: closedConversations.map((conversation) => conversation.id) };
  }

  async function forkAgentProviderSession(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory(noopAdapter());
    if (typeof adapter.forkSession !== "function") throw new Error(`${agent.provider} does not support session/fork`);
    const forked = await adapter.forkSession({ ...input, workspaceRoot, agent });
    const conversation = await createConversation(workspaceRoot, agent.provider, agent.id, {
      title: input.title ?? `Fork ${forked.sessionId}`,
      providerSessionId: forked.sessionId,
      resumeKey: forked.sessionId,
      source: "provider-session-fork",
      metadata: forked.raw ?? null,
    });
    return { ...forked, conversation };
  }

  async function setAgentConfigOption(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const optionId = String(input.optionId ?? input.configOptionId ?? input.id ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!optionId) throw new Error("optionId is required");
    const detected = await legacy.detectAgent(agent, workspaceRoot).catch(() => agent);
    const provider = detected.provider ?? agent.provider;
    const adapterFactory = adapterFactoryForProvider(provider, detected);
    if (!adapterFactory) throw new Error(`No adapter for ${provider}`);
    if ((provider === "codex" || provider === "claude") && !Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) {
      const tool = await ensureManagedAcpTool(provider);
      detected.executablePath = tool.binPath;
      detected.managedAcpTool = tool;
      detected.connectionMode = defaultConnectionMode(provider, detected);
    }
    const adapter = adapterFactory(noopAdapter());
    if (typeof adapter.setConfigOption !== "function") throw new Error(`${provider} does not support config/set`);
    return adapter.setConfigOption({ ...input, optionId, workspaceRoot, agent: detected });
  }

  return {
    warmupConversation,
    listAgentProviderSessions,
    loadAgentProviderSession,
    closeAgentProviderSession,
    forkAgentProviderSession,
    setAgentConfigOption,
  };
}
