import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { personalLocalAgentConversationStatus, type PersonalLocalAgent, type PersonalLocalAgentConversationMessage, type PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";
import { localAgentChatKey } from "../local-agent-page-model";
import type { ChatMessage } from "../messages/message-types";

export function useConversationHistoryHydration(input: {
  workspaceRoot: string;
  agent: PersonalLocalAgent | null | undefined;
  conversationId: string | null | undefined;
  messagesByAgent: Record<string, ChatMessage[]>;
  setMessagesByAgent: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
}) {
  const hydratedRef = useRef<Set<string>>(new Set<string>());
  const { workspaceRoot, agent, conversationId, messagesByAgent, setMessagesByAgent } = input;
  useEffect(() => {
    if (!agent || !conversationId) return;
    const chatKey = localAgentChatKey(agent.id, conversationId);
    if (hydratedRef.current.has(chatKey)) return;
    let cancelled = false;
    void personalLocalAgentConversationStatus({ workspaceRoot, agent, conversationId })
      .then((result) => {
        if (cancelled) return;
        const persisted = (result as unknown as { conversationMessages?: PersonalLocalAgentConversationMessage[] }).conversationMessages ?? [];
        if (!persisted.length) return;
        hydratedRef.current.add(chatKey);
        const last = persisted[persisted.length - 1];
        const runId = `history-${chatKey}-${last?.createdAt ?? Date.now()}`;
        const finishText = [...persisted].reverse().find((m) => m.type === "finish" || (m.role === "assistant" && m.type === "text"))?.text ?? "";
        const historyRun = {
          runId,
          agentId: agent.id,
          conversationId,
          status: (result.status ?? "completed") as PersonalLocalAgentRunResult["status"],
          events: [],
          conversationMessages: persisted,
          errorInfo: null,
          error: null,
          pendingApprovals: [],
          output: finishText,
        } as unknown as PersonalLocalAgentRunResult;
        setMessagesByAgent((current) => {
          const list = current[chatKey] ?? [];
          const filtered = list.filter((m) => !(typeof m.id === "string" && m.id.startsWith("history-")));
          if (filtered.some((m) => m.run?.runId === runId)) return current;
          // If the user already sent messages in this conversation (a user message or a live assistant run exists), skip hydration to avoid appending
          // a duplicate history bubble below the real transcript.
          const hasLiveMessages = filtered.some((m) => m.role === "user" || Boolean(m.run));
          if (hasLiveMessages) return current;
          return {
            ...current,
            [chatKey]: [
              ...filtered,
              {
                id: runId,
                role: "assistant",
                text: finishText || "",
                createdAt: Date.now(),
                run: historyRun,
              },
            ],
          };
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [agent, conversationId, messagesByAgent, setMessagesByAgent, workspaceRoot]);
}
