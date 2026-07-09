import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { personalLocalAgentConversationStatus, type PersonalLocalAgent } from "../../../../app/lib/desktop";
import { localAgentChatKey } from "../local-agent-page-model";
import type { ChatMessage } from "../messages/message-types";

// Replay a persisted transcript (e.g. an archived session imported via
// "resume from archive") into the chat as individual user/assistant bubbles so
// the full back-and-forth is visible. Each bubble gets a stable, history-scoped
// id so it can be de-duplicated on re-hydration.
export function useConversationHistoryHydration(input: {
  workspaceRoot: string;
  agent: PersonalLocalAgent | null | undefined;
  conversationId: string | null | undefined;
  messagesByAgent: Record<string, ChatMessage[]>;
  setMessagesByAgent: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
}) {
  const hydratedRef = useRef<Set<string>>(new Set<string>());
  const { workspaceRoot, agent, conversationId, setMessagesByAgent } = input;
  useEffect(() => {
    if (!agent || !conversationId) return;
    const chatKey = localAgentChatKey(agent.id, conversationId);
    console.log("[hydrate] checking", { chatKey, agent: { provider: agent.provider, id: agent.id }, conversationId });
    if (hydratedRef.current.has(chatKey)) {
      console.log("[hydrate] already hydrated", chatKey);
      return;
    }
    let cancelled = false;
    void personalLocalAgentConversationStatus({ workspaceRoot, agent, conversationId })
      .then((result) => {
        if (cancelled) return;
        const persisted = result.conversationMessages ?? [];
        console.log("[hydrate] status", { chatKey, count: persisted.length });
        if (!persisted.length) return;
        hydratedRef.current.add(chatKey);
        const historyPrefix = `history-${chatKey}-`;
        const historyMessages: ChatMessage[] = persisted.map((message, index) => {
          // Local bubbles only support user/assistant/system; map anything else
          // (e.g. "tool") to assistant so the content is still shown.
          const role: ChatMessage["role"] =
            message.role === "user" ? "user" : message.role === "system" ? "system" : "assistant";
          return {
            id: `${historyPrefix}${message.id ?? index}`,
            role,
            text: message.text ?? "",
            createdAt: Number(message.createdAt) || Date.now() + index,
            run: null,
          };
        });
        setMessagesByAgent((current) => {
          const list = current[chatKey] ?? [];
          const filtered = list.filter(
            (m) => !(typeof m.id === "string" && (m.id.startsWith(historyPrefix) || m.id.startsWith("native-session-")))
          );
          // If the user already sent messages in this conversation (a user message or
          // a live assistant run exists), skip hydration to avoid appending a
          // duplicate history below the real transcript.
          const hasLiveMessages = filtered.some((m) => m.role === "user" || Boolean(m.run));
          if (hasLiveMessages) {
            console.log("[hydrate] skipped (has live messages)", chatKey);
            return current;
          }
          if (filtered.some((m) => typeof m.id === "string" && m.id.startsWith(historyPrefix))) return current;
          console.log("[hydrate] adding", chatKey, historyMessages.length);
          return {
            ...current,
            [chatKey]: [...filtered, ...historyMessages],
          };
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [agent, conversationId, setMessagesByAgent, workspaceRoot]);
}
