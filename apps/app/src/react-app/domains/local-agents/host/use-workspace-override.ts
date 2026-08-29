import { useCallback, useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { t } from "@/i18n";
import {
  personalLocalAgentConversationCreate,
  pickDirectory,
  type PersonalLocalAgent,
  type PersonalLocalAgentConversation,
} from "../../../../app/lib/desktop";
import { localAgentChatKey, welcomeMessageForAgent } from "../local-agent-page-model";
import type { ChatMessage } from "../messages/message-types";
import { addRecentWorkspace, writeWorkspaceOverride } from "../workspace-picker/recent-workspaces";

type UseWorkspaceOverrideArgs = {
  selectedConversation: PersonalLocalAgentConversation | null;
  selectedConversationId: string | null;
  selectedAgent: PersonalLocalAgent | null;
  running: boolean;
  effectiveWorkspaceRoot: string;
  propsWorkspaceRoot: string;
  selectedChatKey: string;
  selectedConversationWorkdir: string;
  messagesByAgent: Record<string, ChatMessage[]>;
  recentWorkspaces: string[];
  setConversationsByAgent: Dispatch<SetStateAction<Record<string, PersonalLocalAgentConversation[]>>>;
  setSelectedConversationIdByAgent: Dispatch<SetStateAction<Record<string, string>>>;
  setMessagesByAgent: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setDraftsByAgent: Dispatch<SetStateAction<Record<string, string>>>;
  setActiveRunIdByAgent: Dispatch<SetStateAction<Record<string, string | null>>>;
  setWorkspaceOverrideState: Dispatch<SetStateAction<string>>;
  setRecentWorkspaces: Dispatch<SetStateAction<string[]>>;
};

export type WorkspaceRunContext = {
  workspaceRoot: string;
  conversationId: string | null;
};

/**
 * Workspace freshness + override logic for the personal local-agent page.
 * Extracted from `personal-local-agent-page.tsx` so that file stays below the
 * god-file line gate. A conversation is editable only while it is "fresh" (no
 * committed workdir and no real messages); mounting/clearing a project re-bases
 * it before a send can capture the destination.
 */
export function useWorkspaceOverride(args: UseWorkspaceOverrideArgs) {
  const {
    selectedConversation,
    selectedConversationId,
    selectedAgent,
    running,
    effectiveWorkspaceRoot,
    propsWorkspaceRoot,
    selectedChatKey,
    selectedConversationWorkdir,
    messagesByAgent,
    recentWorkspaces,
    setConversationsByAgent,
    setSelectedConversationIdByAgent,
    setMessagesByAgent,
    setDraftsByAgent,
    setActiveRunIdByAgent,
    setWorkspaceOverrideState,
    setRecentWorkspaces,
  } = args;

  const selectedConversationHasContent = (messagesByAgent[selectedChatKey] ?? []).some(
    (message) => Boolean(message.run) || message.role === "user",
  );
  const chipEditable = !selectedConversationWorkdir && !selectedConversationHasContent;
  const transitionSequenceRef = useRef(0);
  const pendingTransitionRef = useRef<{
    agentId: string;
    sourceConversationId: string | null;
    promise: Promise<WorkspaceRunContext>;
  } | null>(null);
  const selectedAgentIdRef = useRef(selectedAgent?.id ?? null);
  const selectedConversationIdRef = useRef(selectedConversationId);
  const resolvedRunContextRef = useRef<WorkspaceRunContext>({
    workspaceRoot: effectiveWorkspaceRoot,
    conversationId: selectedConversationId,
  });
  const selectedAgentId = selectedAgent?.id ?? null;
  useLayoutEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
    selectedConversationIdRef.current = selectedConversationId;
    const pendingTransition = pendingTransitionRef.current;
    if (
      pendingTransition
      && (
        pendingTransition.agentId !== selectedAgentId
        || pendingTransition.sourceConversationId !== selectedConversationId
      )
    ) {
      // A workspace rebase belongs to the selection that started it. Invalidate
      // it after the new selection commits so abandoned concurrent renders
      // cannot cancel routing work for the currently visible conversation.
      transitionSequenceRef.current += 1;
      pendingTransitionRef.current = null;
    }
    if (!pendingTransitionRef.current) {
      resolvedRunContextRef.current = {
        workspaceRoot: effectiveWorkspaceRoot,
        conversationId: selectedConversationId,
      };
    }
  }, [effectiveWorkspaceRoot, selectedAgentId, selectedConversationId]);

  const selectedIsFreshConversation = useCallback(() => {
    if (selectedConversation?.workdir?.trim()) return false;
    return !selectedConversationHasContent;
  }, [selectedConversationHasContent, selectedConversation]);

  const rebaseFreshConversation = useCallback(
    async (partitionRoot: string, committedWorkdir: string | null) => {
      if (!selectedAgent || running) return null;
      if (!selectedIsFreshConversation()) return null;
      const agent = selectedAgent;
      const result = await personalLocalAgentConversationCreate({
        workspaceRoot: partitionRoot,
        agent,
        workdir: committedWorkdir,
      });
      return { agent, conversation: result.conversation };
    },
    [running, selectedAgent, selectedIsFreshConversation],
  );

  const startWorkspaceTransition = useCallback((partitionRoot: string) => {
    const sequence = transitionSequenceRef.current + 1;
    transitionSequenceRef.current = sequence;

    if (!selectedAgent || !selectedConversation || !selectedIsFreshConversation()) {
      pendingTransitionRef.current = null;
      resolvedRunContextRef.current = {
        workspaceRoot: partitionRoot,
        conversationId: selectedConversationId,
      };
      return;
    }

    const previousConversationId = selectedConversationId;
    const previousChatKey = selectedChatKey;
    const previousRunContext = resolvedRunContextRef.current;
    const transition = rebaseFreshConversation(partitionRoot, null)
      .then((rebased): WorkspaceRunContext => {
        const stillSelected = selectedAgentIdRef.current === selectedAgent.id
          && selectedConversationIdRef.current === previousConversationId;
        if (sequence !== transitionSequenceRef.current || !stillSelected || !rebased) {
          return resolvedRunContextRef.current;
        }
        const { agent, conversation } = rebased;
        selectedConversationIdRef.current = conversation.id;
        resolvedRunContextRef.current = {
          workspaceRoot: partitionRoot,
          conversationId: conversation.id,
        };
        setConversationsByAgent((current) => ({
          ...current,
          [agent.id]: [conversation, ...(current[agent.id] ?? []).filter((item) => item.id !== previousConversationId)],
        }));
        setSelectedConversationIdByAgent((current) => ({ ...current, [agent.id]: conversation.id }));
        const key = localAgentChatKey(agent.id, conversation.id);
        setMessagesByAgent((current) => ({ ...current, [key]: [welcomeMessageForAgent(agent)] }));
        setDraftsByAgent((current) => ({ ...current, [key]: current[previousChatKey] ?? "" }));
        setActiveRunIdByAgent((current) => ({ ...current, [key]: null }));
        return resolvedRunContextRef.current;
      })
      .catch((error) => {
        const stillSelected = selectedAgentIdRef.current === selectedAgent.id
          && selectedConversationIdRef.current === previousConversationId;
        if (sequence === transitionSequenceRef.current && stillSelected) {
          resolvedRunContextRef.current = previousRunContext;
          const previousOverride = previousRunContext.workspaceRoot === propsWorkspaceRoot
            ? ""
            : previousRunContext.workspaceRoot;
          writeWorkspaceOverride(previousOverride);
          setWorkspaceOverrideState(previousOverride);
        }
        throw error;
      })
      .finally(() => {
        if (sequence === transitionSequenceRef.current) pendingTransitionRef.current = null;
      });
    void transition.catch(() => undefined);
    pendingTransitionRef.current = {
      agentId: selectedAgent.id,
      sourceConversationId: previousConversationId,
      promise: transition,
    };
  }, [
    propsWorkspaceRoot,
    rebaseFreshConversation,
    selectedAgent,
    selectedChatKey,
    selectedConversation,
    selectedConversationId,
    selectedIsFreshConversation,
    setActiveRunIdByAgent,
    setConversationsByAgent,
    setDraftsByAgent,
    setMessagesByAgent,
    setSelectedConversationIdByAgent,
    setWorkspaceOverrideState,
  ]);

  const resolveWorkspaceRunContext = useCallback(async (): Promise<WorkspaceRunContext> => {
    const pending = pendingTransitionRef.current;
    if (
      pending
      && pending.agentId === selectedAgent?.id
      && pending.sourceConversationId === selectedConversationId
    ) return pending.promise;
    return resolvedRunContextRef.current;
  }, [selectedAgent?.id, selectedConversationId]);

  const applyWorkspaceOverride = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      writeWorkspaceOverride(trimmed);
      setWorkspaceOverrideState(trimmed);
      if (trimmed) {
        setRecentWorkspaces(addRecentWorkspace(trimmed));
      }
      // If a fresh (no-workdir, no-messages) conversation is selected, re-create
      // it under the mounted project's partition but DO NOT commit the workdir
      // yet. The chip must stay editable before the first message so the user can
      // re-pick a project if they chose the wrong one. The project is displayed
      // via `effectiveWorkspaceRoot` (the override), and the workdir is committed
      // (and the chip locked) only after the first run finishes on the server.
      startWorkspaceTransition(trimmed || propsWorkspaceRoot || "");
    },
    [propsWorkspaceRoot, setRecentWorkspaces, setWorkspaceOverrideState, startWorkspaceTransition],
  );

  const clearWorkspaceOverride = useCallback(() => {
    writeWorkspaceOverride("");
    setWorkspaceOverrideState("");
    // Clearing / removing the project must NOT lock the chip. Re-base into the
    // default partition but keep the workdir `null` so the conversation stays
    // fresh and the chip remains editable ("no project" state), instead of
    // immediately showing "directory locked".
    startWorkspaceTransition(propsWorkspaceRoot || "");
  }, [propsWorkspaceRoot, setWorkspaceOverrideState, startWorkspaceTransition]);

  const browseWorkspaceOverride = useCallback(async () => {
    const picked = await pickDirectory({
      title: t("local_agent.workspace_choose_different_folder"),
      defaultPath: effectiveWorkspaceRoot || propsWorkspaceRoot || undefined,
    });
    const target = Array.isArray(picked) ? picked[0] : picked;
    if (typeof target === "string" && target.trim()) {
      applyWorkspaceOverride(target.trim());
    }
  }, [applyWorkspaceOverride, effectiveWorkspaceRoot, propsWorkspaceRoot]);

  const workspaceRecentList = useMemo(() => {
    const base = recentWorkspaces.slice();
    const rootTrim = (propsWorkspaceRoot ?? "").trim();
    if (rootTrim && !base.includes(rootTrim)) {
      base.push(rootTrim);
    }
    return base;
  }, [recentWorkspaces, propsWorkspaceRoot]);

  return {
    chipEditable,
    applyWorkspaceOverride,
    clearWorkspaceOverride,
    browseWorkspaceOverride,
    workspaceRecentList,
    resolveWorkspaceRunContext,
  };
}
