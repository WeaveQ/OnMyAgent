import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";

import {
  buildAgentSystemPrompt,
  buildAgentToolAccess,
  createExpertOperationId,
  friendlyModelNameToModelRef,
  isValidSdkModelRef,
  resolveAgentAvatarUrl,
  usePendingAgentStore,
  type AgentCardItem,
  type AgentRegistry,
  type PendingAgentContext,
} from "../../agents";
import type { ExpertDirectoryIdentityIndex } from "../../../capabilities/session-identity/expert-directory-store";
import { prewarmOnMyAgentEnvSystemContext } from "../../shared";
import {
  readExpertSessionSelection,
  resolveExpertSessionSelection,
  writeExpertSessionSelection,
  type AgentConversationGroup,
} from "../sidebar/session-chrome";
import type { StorePrimaryTab } from "../components/side-panel-pages";
import {
  resolveExpertSidebarOpen,
  shouldExitDraftForExpertSidebarTarget,
} from "./expert-conversation-model";
import { useExpertBoundDraftTransition } from "./use-expert-bound-draft-transition";
import { useOpenExpertSession } from "./use-open-expert-session";
import type {
  ExpertSurfaceEvent,
  ExpertSurfaceState,
} from "./expert-surface-machine";
import type { ExpertPageProps } from "./use-expert-page";

/** Owns Expert draft/create/tab navigation transactions and their side effects. */
export function useExpertPageNavigation(input: {
  props: ExpertPageProps;
  draftAgentContexts: Record<string, PendingAgentContext>;
  setDraftAgentContexts: Dispatch<SetStateAction<Record<string, PendingAgentContext>>>;
  pendingAgent: PendingAgentContext | null;
  draftAgentId: string | null;
  draftSessionActive: boolean;
  activeDraftSessionId: string | null;
  surfaceState: ExpertSurfaceState;
  dispatchSurface: (event: ExpertSurfaceEvent) => void;
  openSurfaceDraft: (agent: PendingAgentContext) => void;
  clearSurfaceDraft: () => void;
  openRailView: (view: "chat" | "store") => void;
  identity: ExpertDirectoryIdentityIndex;
  conversationGroups: AgentConversationGroup[];
  sessionTabOrderIdsByScope: Record<string, string[]>;
  registry: AgentRegistry | null;
  setStoreActiveTab: Dispatch<SetStateAction<StorePrimaryTab>>;
}) {
  const { props } = input;
  const activateDraftAgent = useCallback((agent: PendingAgentContext) => {
    input.setDraftAgentContexts((current) => ({ ...current, [agent.id]: agent }));
    usePendingAgentStore.getState().setAgent(agent);
    input.openSurfaceDraft(agent);
    prewarmOnMyAgentEnvSystemContext(props.onmyagentServerClient);
  }, [input.openSurfaceDraft, input.setDraftAgentContexts, props]);

  const openFreshExpertDraft = useCallback(() => {
    props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId);
  }, [props.selectedWorkspaceId, props.sidebar]);

  const handleOpenDraftSession = useCallback((sessionId: string) => {
    const agentId = sessionId.split(":").slice(2).join(":");
    const agent = agentId ? input.draftAgentContexts[agentId] : null;
    if (!agent) return;
    activateDraftAgent(agent);
    openFreshExpertDraft();
    activateDraftAgent(agent);
  }, [activateDraftAgent, input.draftAgentContexts, openFreshExpertDraft]);

  const resolveSessionTabForAgent = useCallback(
    (agentId: string, sessionIds: readonly string[]) => {
      const workspaceId = props.selectedWorkspaceId.trim();
      return resolveExpertSessionSelection({
        rememberedSessionId: readExpertSessionSelection(workspaceId, agentId),
        sessionIds,
        orderIds: input.sessionTabOrderIdsByScope[`${workspaceId}:${agentId}`] ?? [],
      });
    },
    [input.sessionTabOrderIdsByScope, props.selectedWorkspaceId],
  );

  const handleOpenExpertSession = useOpenExpertSession({
    sidebar: props.sidebar,
    draftAgentContexts: input.draftAgentContexts,
    pendingAgent: input.pendingAgent,
    draftAgentId: input.draftAgentId,
    draftSessionActive: input.draftSessionActive,
    setDraftAgentContexts: input.setDraftAgentContexts,
    clearSurfaceDraft: input.clearSurfaceDraft,
    onOpenRealSession: (workspaceId, agentId, sessionId) => {
      input.dispatchSurface({ type: "SYNC_ROUTE", workspaceId, agentId, sessionId });
    },
    openRailView: input.openRailView,
    expertDirectoryIdentity: input.identity,
  });

  const handleOpenExpertFromSidebar = useCallback(
    (workspaceId: string, hintSessionId: string) => {
      const hint = hintSessionId.trim();
      const agentId = (
        hint && !hint.startsWith("draft:")
          ? input.identity.agentIdBySessionId.get(hint) ?? null
          : null
      ) || input.conversationGroups.find((group) =>
        group.sessions.some((session) => session.id === hint)
      )?.agentId || null;
      if (!agentId) {
        handleOpenExpertSession(workspaceId, hintSessionId);
        return;
      }
      const group = input.conversationGroups.find((item) => item.agentId === agentId);
      const sessionIds = group?.sessions.map((session) => session.id) ?? (hint ? [hint] : []);
      const target = resolveExpertSidebarOpen({
        hintSessionId,
        rememberedSessionId: readExpertSessionSelection(workspaceId, agentId),
        orderIds: input.sessionTabOrderIdsByScope[`${workspaceId.trim()}:${agentId}`] ?? [],
        readySessionIds: sessionIds,
        selectedSessionId: props.selectedSessionId,
      });
      if (!target.sessionId) return;
      if (!target.shouldOpen) {
        if (shouldExitDraftForExpertSidebarTarget({
          draftAgentId: input.draftAgentId,
          draftSessionActive: input.draftSessionActive,
          targetAgentId: agentId,
        })) {
          handleOpenExpertSession(workspaceId, target.sessionId);
          return;
        }
        input.openRailView("chat");
        return;
      }
      handleOpenExpertSession(workspaceId, target.sessionId);
    }, [handleOpenExpertSession, input, props.selectedSessionId],
  );

  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() ?? "";
    if (!sessionId || sessionId.startsWith("draft:") || !input.identity.sessionIds.has(sessionId)) return;
    const agentId = input.identity.agentIdBySessionId.get(sessionId);
    if (agentId) writeExpertSessionSelection(props.selectedWorkspaceId, agentId, sessionId);
  }, [input.identity, props.selectedSessionId, props.selectedWorkspaceId]);

  useExpertBoundDraftTransition({
    activeDraftSessionId: input.activeDraftSessionId,
    draftAgentContexts: input.draftAgentContexts,
    draftAgentId: input.draftAgentId,
    draftSessionActive: input.draftSessionActive,
    pendingAgent: input.pendingAgent,
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    sidebarSelectedWorkspaceId: props.sidebar.selectedWorkspaceId,
    onOpenSession: props.sidebar.onOpenSession,
    surfaceState: input.surfaceState,
    dispatchSurface: input.dispatchSurface,
    clearSurfaceDraft: input.clearSurfaceDraft,
    setDraftAgentContexts: input.setDraftAgentContexts,
  });

  const handleStartAgentConversation = useCallback((item: AgentCardItem, registry: AgentRegistry) => {
    const source = item.kind === "template" ? item.template : item.agent;
    const avatarInput = {
      avatarStyle: source.avatarStyle,
      avatarOptionId: source.avatarOptionId,
      customAvatarDataUrl: item.kind === "custom" ? item.agent.customAvatarDataUrl : null,
    };
    const { url: avatarUrl, background: avatarBackground } =
      resolveAgentAvatarUrl(avatarInput, registry);
    const modelRef = isValidSdkModelRef(source.sdkProviderID, source.sdkModelID)
      ? { providerID: source.sdkProviderID!, modelID: source.sdkModelID! }
      : friendlyModelNameToModelRef(source.modelProvider, source.model);
    const pending: PendingAgentContext = {
      id: source.id,
      name: source.name,
      description: source.description,
      avatar: { ...avatarInput, avatarUrl, avatarBackground },
      systemPrompt: buildAgentSystemPrompt(source),
      tools: buildAgentToolAccess(source),
      model: modelRef ?? undefined,
      operationId: createExpertOperationId(),
      draftCreatedAt: Date.now(),
      draftSource: "agent-selection",
    };
    activateDraftAgent(pending);
    openFreshExpertDraft();
    activateDraftAgent(pending);
  }, [activateDraftAgent, openFreshExpertDraft]);

  const handleStartAgentById = useCallback((agentId: string) => {
    if (!input.registry) return;
    const agent = input.registry.agents.find((item) => item.id === agentId) ??
      input.registry.templates.find((item) => item.id === agentId);
    if (!agent) return;
    handleStartAgentConversation(
      "showInOverview" in agent
        ? { kind: "template", id: agent.id, template: agent }
        : { kind: "custom", id: agent.id, agent },
      input.registry,
    );
  }, [handleStartAgentConversation, input.registry]);

  const openExpertMarket = useCallback(() => {
    input.setStoreActiveTab("experts");
    input.openRailView("store");
  }, [input.openRailView, input.setStoreActiveTab]);

  return {
    activateDraftAgent,
    openFreshExpertDraft,
    handleOpenDraftSession,
    resolveSessionTabForAgent,
    handleOpenExpertSession,
    handleOpenExpertFromSidebar,
    handleStartAgentConversation,
    handleStartAgentById,
    openExpertMarket,
  };
}
