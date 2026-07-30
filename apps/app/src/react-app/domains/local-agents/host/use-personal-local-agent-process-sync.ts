/**
 * Poll ACP process list for background runs started outside this tab.
 * Pauses while the document is hidden.
 */
import { useEffect, type Dispatch, type SetStateAction } from "react";

import { t } from "@/i18n";
import {
  personalLocalAgentAcpProcessesList,
  type PersonalLocalAgent,
} from "../../../../app/lib/desktop";
import {
  isDocumentHidden,
  shouldRunPollTick,
} from "../../../infra/visibility-poll";
import {
  localAgentChatKey,
  welcomeMessageForAgent,
} from "../local-agent-page-model";
import type { ChatMessage } from "../messages/message-types";
import {
  messageTextForRun,
  nowId,
  placeholderRunFromProcess,
} from "./personal-local-agent-page-helpers";

const PROCESS_SYNC_INTERVAL_MS = 5_000;

export function usePersonalLocalAgentProcessSync(input: {
  agents: PersonalLocalAgent[];
  setActiveRunIdByAgent: Dispatch<SetStateAction<Record<string, string | null>>>;
  setMessagesByAgent: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
}): void {
  const { agents, setActiveRunIdByAgent, setMessagesByAgent } = input;

  useEffect(() => {
    let cancelled = false;
    const syncBackgroundProcesses = async () => {
      try {
        const result = await personalLocalAgentAcpProcessesList();
        if (cancelled) return;
        for (const process of result.processes) {
          const run = placeholderRunFromProcess(process);
          if (!run) continue;
          const chatKey = localAgentChatKey(
            run.agentId,
            process.conversationId || undefined,
          );
          setActiveRunIdByAgent((current) =>
            current[chatKey] === run.runId
              ? current
              : { ...current, [chatKey]: run.runId },
          );
          setMessagesByAgent((current) => {
            const existing = current[chatKey] ?? [];
            if (existing.some((message) => message.run?.runId === run.runId)) {
              return current;
            }
            const agent = agents.find((item) => item.id === run.agentId) ?? null;
            return {
              ...current,
              [chatKey]: [
                ...(existing.length
                  ? existing
                  : agent
                    ? [welcomeMessageForAgent(agent)]
                    : []),
                {
                  id: nowId("assistant"),
                  role: "assistant",
                  text: messageTextForRun(run, t("local_agent.running")),
                  createdAt: Date.now(),
                  run,
                },
              ],
            };
          });
        }
      } catch {
        // Background process sync is best-effort; run polling still owns final status.
      }
    };
    void syncBackgroundProcesses();
    const timer = window.setInterval(() => {
      if (!shouldRunPollTick(isDocumentHidden())) return;
      void syncBackgroundProcesses();
    }, PROCESS_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agents, setActiveRunIdByAgent, setMessagesByAgent]);
}
