import { useEffect, type Dispatch, type SetStateAction } from "react";

import {
  personalLocalAgentConversationStatus,
  personalLocalAgentConversationTranscript,
  type PersonalLocalAgent,
  type PersonalLocalAgentConversation,
} from "../../../../app/lib/desktop";
import {
  isUnsupportedNativeTranscriptError,
  localAgentChatKey,
  nativeSessionResumeOnlyMessage,
  transcriptMessagesForAgent,
} from "../local-agent-page-model";
import type { ChatMessage } from "../messages/message-types";
import {
  conversationStatusToChatMessages,
  mergeHydratedChatMessages,
} from "./personal-local-agent-history";

// Replay a persisted transcript (e.g. an archived session imported via
// "resume from archive") into the chat as individual user/assistant bubbles so
// the full back-and-forth is visible. Each bubble gets a stable, history-scoped
// id so it can be de-duplicated on re-hydration.
export function useConversationHistoryHydration(input: {
  workspaceRoot: string;
  agent: PersonalLocalAgent | null | undefined;
  conversationId: string | null | undefined;
  conversation?: PersonalLocalAgentConversation | null;
  chatKey?: string;
  /**
   * Re-hydrate when the selected conversation enters or leaves an active run.
   * The terminal renderer snapshot can be intentionally compact, while the
   * conversation checkpoint owns the complete thought/tool event timeline.
   */
  refreshKey?: string | null;
  allowNativeFallback?: boolean;
  setMessagesByAgent: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setErrorsByAgent?: Dispatch<SetStateAction<Record<string, string | null>>>;
}) {
  const {
    workspaceRoot,
    agent,
    conversationId,
    conversation,
    chatKey: explicitChatKey,
    refreshKey,
    allowNativeFallback = true,
    setMessagesByAgent,
    setErrorsByAgent,
  } = input;
  useEffect(() => {
    if (!agent || !conversationId) return;
    const chatKey = explicitChatKey || localAgentChatKey(agent.id, conversationId);
    let cancelled = false;
    void (async () => {
      let historyMessages: ChatMessage[] = [];
      let activeRunId: string | null = null;
      try {
        const result = await personalLocalAgentConversationStatus({ workspaceRoot, agent, conversationId });
        historyMessages = conversationStatusToChatMessages(chatKey, result);
        activeRunId = result.activeRun?.status === "running" ? result.activeRun.runId : null;
      } catch {
        // Native provider transcript remains an empty-runtime fallback below.
      }
      if (
        historyMessages.length === 0
        && allowNativeFallback
        && conversation
        && (conversation.resumeKey || conversation.providerSessionId)
      ) {
        try {
          const result = await personalLocalAgentConversationTranscript({
            workspaceRoot,
            conversationId,
            providerSessionId: conversation.providerSessionId,
            resumeKey: conversation.resumeKey,
            agent,
            limit: 80,
          });
          historyMessages = result.messages.length
            ? transcriptMessagesForAgent(agent, result.messages)
            : isUnsupportedNativeTranscriptError(result.error)
              ? [nativeSessionResumeOnlyMessage(agent, conversation)]
              : [];
          if (!cancelled && result.error && !isUnsupportedNativeTranscriptError(result.error)) {
            setErrorsByAgent?.((current) => ({ ...current, [agent.id]: result.error ?? null }));
          }
        } catch (nextError) {
          if (!cancelled) {
            setErrorsByAgent?.((current) => ({
              ...current,
              [agent.id]: nextError instanceof Error ? nextError.message : String(nextError),
            }));
          }
        }
      }
      if (cancelled || historyMessages.length === 0) return;
      setMessagesByAgent((current) => {
        const list = current[chatKey] ?? [];
        return {
          ...current,
          [chatKey]: mergeHydratedChatMessages(list, historyMessages, activeRunId),
        };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    agent,
    allowNativeFallback,
    conversation,
    conversationId,
    explicitChatKey,
    refreshKey,
    setErrorsByAgent,
    setMessagesByAgent,
    workspaceRoot,
  ]);
}
