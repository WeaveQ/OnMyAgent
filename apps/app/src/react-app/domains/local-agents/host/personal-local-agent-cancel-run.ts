import type { Dispatch, SetStateAction } from "react";

import { t } from "@/i18n";
import {
  personalLocalAgentAcpCancel,
  personalLocalAgentStatus,
  type PersonalLocalAgent,
  type PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";
import { welcomeMessageForAgent } from "../local-agent-page-model";
import type { ChatMessage } from "../messages/message-types";
import { messageTextForRun } from "./personal-local-agent-page-helpers";

export async function cancelPersonalLocalAgentRun(input: {
  runId: string;
  chatKey: string;
  agents: PersonalLocalAgent[];
  workspaceRoot: string;
  rememberRunResult: (agentId: string, snapshot: PersonalLocalAgentRunResult) => void;
  setErrorsByAgent: Dispatch<SetStateAction<Record<string, string | null>>>;
  setMessagesByAgent: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setActiveRunIdByAgent: Dispatch<SetStateAction<Record<string, string | null>>>;
}): Promise<void> {
  const { runId, chatKey } = input;
  if (!runId || !chatKey) return;
  const agentId = chatKey.split("::")[0] ?? chatKey;
  const runAgent = input.agents.find((agent) => agent.id === agentId) ?? null;
  input.setErrorsByAgent((current) => ({ ...current, [agentId]: null }));
  try {
    const result = await personalLocalAgentAcpCancel(runId);
    if (!result.ok) {
      input.setErrorsByAgent((current) => ({
        ...current,
        [agentId]: result.error ?? t("local_agent.cancel_failed"),
      }));
    }
    const snapshot = await personalLocalAgentStatus({
      runId,
      workspaceRoot: input.workspaceRoot,
    });
    input.setMessagesByAgent((current) => ({
      ...current,
      [chatKey]: (current[chatKey] ?? (runAgent ? [welcomeMessageForAgent(runAgent)] : [])).map((message) =>
        message.run?.runId === runId
          ? { ...message, text: messageTextForRun(snapshot, message.text), run: snapshot }
          : message,
      ),
    }));
    input.setActiveRunIdByAgent((current) => ({ ...current, [chatKey]: null }));
    input.rememberRunResult(agentId, snapshot);
  } catch (nextError) {
    input.setErrorsByAgent((current) => ({
      ...current,
      [agentId]: nextError instanceof Error ? nextError.message : String(nextError),
    }));
  }
}
