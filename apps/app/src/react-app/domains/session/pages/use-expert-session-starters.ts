import { useCallback } from "react";
import {
  buildPendingAgentFromRecord,
  createExpertOperationId,
  type AgentRegistry,
  type PendingAgentContext,
} from "../../agents";
import { buildPendingAgentFromMarketplaceExpert } from "@/react-app/domains/agents";
import { installSummonedMarketplaceExpert } from "@/react-app/domains/plugins";
import { resolveMarketplaceExpertStartPrompt } from "@/react-app/domains/plugins";
import type { ExpertMarketplaceEntry } from "@/react-app/domains/plugins";
import type {
  AgentConversationGroup,
  OnMyAgentPrimaryView,
} from "../sidebar/session-chrome";
import {
  marketplaceExpertMatchesAgentId,
  pendingAgentMatchesMarketplaceExpert,
} from "./expert-page-utils";
import {
  setExpertComposerDraftAfterNewTask,
  setExpertComposerTemplateAfterNewTask,
} from "./shared-page-utils";

export function useExpertSessionStarters(input: {
  conversationGroups: AgentConversationGroup[];
  draftAgentContexts: Record<string, PendingAgentContext>;
  registry: AgentRegistry | null | undefined;
  pendingAgent: PendingAgentContext | null;
  activeAgentContext: PendingAgentContext | null;
  activeConversationAgentId: string | null;
  currentConversationAgentId: string | null;
  draftAgentId: string | null;
  selectedWorkspaceId: string;
  sidebarSelectedWorkspaceId: string;
  onCreateFreshSessionForAgent?: (workspaceId: string) => void | Promise<void>;
  activateDraftAgent: (agent: PendingAgentContext) => void;
  openFreshExpertDraft: () => void;
  openRailView: (view: OnMyAgentPrimaryView) => void;
  openExpertMarket: () => void;
  handleOpenExpertSession: (workspaceId: string, sessionId: string) => void;
  resolveSessionTabForAgent: (
    agentId: string,
    sessionIds: readonly string[],
  ) => string | null;
  localExpertPackages: ExpertMarketplaceEntry[];
  handleStartAgentById: (agentId: string) => void;
}) {
  const handleStartMarketplaceExpert = useCallback(
    (expert: ExpertMarketplaceEntry, initialPrompt?: string) => {
      // Always open a **fresh** expert draft (「去聊天」/「召唤」).
      // Re-opening the latest history session left users on an old auto-title
      // (often first-message text) instead of a clean new chat; resume stays
      // on the conversation list.
      const startPrompt = resolveMarketplaceExpertStartPrompt(
        expert,
        initialPrompt,
      );

      const existingDraftAgent = Object.values(input.draftAgentContexts).find(
        (agent) => pendingAgentMatchesMarketplaceExpert(agent, expert),
      );
      // Build pending first. openFreshExpertDraft may clear pending; re-assert after.
      const pending =
        existingDraftAgent ?? buildPendingAgentFromMarketplaceExpert(expert);
      const pendingWithStart: PendingAgentContext = {
        ...pending,
        boundSessionId: undefined,
        operationId: createExpertOperationId(),
        draftCreatedAt: Date.now(),
        draftSource: "agent-selection",
      };
      input.activateDraftAgent(pendingWithStart);
      // Leave 市场 immediately — without this, UI stays on store while draft
      // state churns (felt like a freeze after 「去聊天」). Matches expert-create.
      input.openRailView("chat");
      input.openFreshExpertDraft();
      // Re-assert after create-task's synchronous setAgent(null).
      input.activateDraftAgent(pendingWithStart);
      // Prefill only for explicit quick-prompt pick or logistics templates —
      // never dump a default intro into a blank new chat.
      if (startPrompt?.template) {
        setExpertComposerTemplateAfterNewTask(
          input.selectedWorkspaceId,
          pendingWithStart.id,
          startPrompt.prompt,
        );
      } else if (startPrompt && initialPrompt?.trim()) {
        setExpertComposerDraftAfterNewTask(
          input.selectedWorkspaceId,
          pendingWithStart.id,
          startPrompt.prompt,
        );
      }
      // Already-installed packages resolve instantly via coordinator cache.
      void installSummonedMarketplaceExpert(expert).catch((error) => {
        console.warn(
          "[expert-marketplace] failed to install expert package",
          error,
        );
      });
    },
    [input],
  );

  const handleCreateCurrentAgentSession = useCallback(() => {
    // Prefer the expert currently shown (tab strip / left selection), never the
    // globally most-recent expert session.
    const agentId =
      input.activeConversationAgentId
      ?? input.currentConversationAgentId
      ?? input.activeAgentContext?.id
      ?? input.draftAgentId;
    if (!agentId) {
      input.openExpertMarket();
      return;
    }
    let nextAgent: PendingAgentContext | null = null;
    if (input.activeAgentContext?.id === agentId) {
      nextAgent = {
        ...input.activeAgentContext,
        boundSessionId: undefined,
        operationId: createExpertOperationId(),
        draftCreatedAt: Date.now(),
        draftSource: "new-session",
      };
    } else if (input.registry) {
      const agent =
        input.registry.agents.find((item) => item.id === agentId)
        ?? input.registry.templates.find((item) => item.id === agentId);
      const restored = agent
        ? buildPendingAgentFromRecord(agent, input.registry)
        : null;
      if (restored) {
        nextAgent = {
          ...restored,
          operationId: createExpertOperationId(),
          draftCreatedAt: Date.now(),
          draftSource: "new-session",
        };
      }
    }
    if (!nextAgent && input.pendingAgent?.id === agentId) {
      nextAgent = {
        ...input.pendingAgent,
        boundSessionId: undefined,
        operationId: createExpertOperationId(),
        draftCreatedAt: Date.now(),
        draftSource: "new-session",
      };
    }
    if (nextAgent) {
      // Same pattern as marketplace summon: create-task clears pendingAgent and
      // selectedSessionId. Re-assert draft after so the recency-sorted
      // conversationGroups[0] fallback cannot steal focus to the last-chatted
      // expert (e.g. open agent 1 New Session → land on agent 3's recent tab).
      input.activateDraftAgent(nextAgent);
      input.openFreshExpertDraft();
      input.activateDraftAgent(nextAgent);
    } else if (input.onCreateFreshSessionForAgent) {
      void Promise.resolve(
        input.onCreateFreshSessionForAgent(input.selectedWorkspaceId),
      );
      input.openRailView("chat");
    }
  }, [input]);

  const handleOpenExpertStarter = useCallback((agentId: string) => {
    const localExpert = input.localExpertPackages.find((expert) =>
      marketplaceExpertMatchesAgentId(expert, agentId));
    if (localExpert) {
      handleStartMarketplaceExpert(localExpert);
      return;
    }
    input.handleStartAgentById(agentId);
  }, [handleStartMarketplaceExpert, input]);

  return {
    handleStartMarketplaceExpert,
    handleCreateCurrentAgentSession,
    handleOpenExpertStarter,
  };
}
