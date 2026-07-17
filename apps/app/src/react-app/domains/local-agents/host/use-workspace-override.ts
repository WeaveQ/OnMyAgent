import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
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

/**
 * Workspace freshness + override logic for the personal local-agent page.
 * Extracted from `personal-local-agent-page.tsx` so that file stays below the
 * god-file line gate. Behavior is identical to the original inline callbacks:
 * a conversation is editable only while it is "fresh" (no committed workdir and
 * no real messages), and mounting/clearing a project re-bases the conversation
 * into the chosen partition without locking the chip before the first message.
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

  const selectedIsFreshConversation = useCallback(() => {
    if (selectedConversation?.workdir?.trim()) return false;
    return !selectedConversationHasContent;
  }, [selectedConversationHasContent, selectedConversation]);

  const rebaseFreshConversation = useCallback(
    async (partitionRoot: string, committedWorkdir: string | null) => {
      if (!selectedAgent || running) return;
      if (!selectedIsFreshConversation()) return;
      const agent = selectedAgent;
      const result = await personalLocalAgentConversationCreate({
        workspaceRoot: partitionRoot,
        agent,
        workdir: committedWorkdir,
      });
      setConversationsByAgent((current) => ({
        ...current,
        [agent.id]: [result.conversation, ...(current[agent.id] ?? []).filter((item) => item.id !== selectedConversationId)],
      }));
      setSelectedConversationIdByAgent((current) => ({ ...current, [agent.id]: result.conversation.id }));
      const key = localAgentChatKey(agent.id, result.conversation.id);
      setMessagesByAgent((current) => ({ ...current, [key]: [welcomeMessageForAgent(agent)] }));
      setDraftsByAgent((current) => ({ ...current, [key]: "" }));
      setActiveRunIdByAgent((current) => ({ ...current, [key]: null }));
    },
    [running, selectedAgent, selectedConversationId, selectedIsFreshConversation],
  );

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
      if (trimmed && selectedAgent && selectedConversation && selectedIsFreshConversation()) {
        void rebaseFreshConversation(trimmed, null);
      }
    },
    [rebaseFreshConversation, selectedAgent, selectedConversation, selectedIsFreshConversation],
  );

  const clearWorkspaceOverride = useCallback(() => {
    writeWorkspaceOverride("");
    setWorkspaceOverrideState("");
    // Clearing / removing the project must NOT lock the chip. Re-base into the
    // default partition but keep the workdir `null` so the conversation stays
    // fresh and the chip remains editable ("no project" state), instead of
    // immediately showing "directory locked".
    if (selectedAgent && selectedConversation && selectedIsFreshConversation()) {
      void rebaseFreshConversation(propsWorkspaceRoot || "", null);
    }
  }, [propsWorkspaceRoot, rebaseFreshConversation, selectedAgent, selectedConversation, selectedIsFreshConversation]);

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
  };
}
