import { t } from "@/i18n";
import type {
  PersonalLocalAgentConversationMessage,
  PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";
import { sanitizeAssistantTranscriptText } from "../../../capabilities/conversation/assistant-text-sanitize";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "missing"]);
const PROCESS_TYPES = new Set([
  "thinking",
  "thought",
  "plan",
  "tool",
  "tool_group",
  "acp_tool_call",
  "file_change",
  "file-change",
]);
const ALWAYS_VISIBLE_TYPES = new Set(["error", "tips"]);

export type LocalAgentTurnProcessStep = {
  id: string;
  message: PersonalLocalAgentConversationMessage;
};

export type LocalAgentTurnPresentation = {
  hasProcess: boolean;
  collapseEligible: boolean;
  durationMs: number | null;
  durationLabel: string | null;
  processSteps: LocalAgentTurnProcessStep[];
  alwaysVisibleSteps: LocalAgentTurnProcessStep[];
};

export function formatLocalAgentTurnDuration(durationMs: number) {
  const count = Math.max(0, Math.round(durationMs / 1_000));
  return t("local_agent.elapsed_seconds", { count });
}

export function localAgentTurnDurationMs(run: PersonalLocalAgentRunResult): number | null {
  if (!run.startedAt) return null;
  const end = run.finishedAt ?? (TERMINAL_STATUSES.has(run.status) ? run.startedAt : Date.now());
  return Math.max(0, end - run.startedAt);
}

function textOf(message: PersonalLocalAgentConversationMessage) {
  return (message.text ?? "").trim();
}

function isPendingApproval(
  message: PersonalLocalAgentConversationMessage,
  pendingIds: Set<string>,
) {
  const id = message.approval?.id;
  return Boolean(id && pendingIds.has(id));
}

function isFinalBodyMessage(
  message: PersonalLocalAgentConversationMessage,
  finalText: string,
) {
  if (message.type === "finish") return true;
  if (!finalText) return false;
  if (message.role !== "assistant") return false;
  if (PROCESS_TYPES.has(message.type) || message.type === "permission") return false;
  return textOf(message) === finalText;
}

function explodeProcessMessage(
  message: PersonalLocalAgentConversationMessage,
): PersonalLocalAgentConversationMessage[] {
  if (message.type !== "tool_group") return [message];
  const calls = message.toolCalls ?? [];
  return calls.length ? calls : [message];
}

function sourceMessages(
  run: PersonalLocalAgentRunResult,
  timelineMessages: PersonalLocalAgentConversationMessage[],
) {
  if (run.conversationMessages?.length) return run.conversationMessages;
  return timelineMessages;
}

function canMergeThinking(
  previous: PersonalLocalAgentConversationMessage | undefined,
  message: PersonalLocalAgentConversationMessage,
) {
  if (!previous || previous.type !== "thinking" || message.type !== "thinking") return false;
  const previousKey = previous.msgId ?? previous.id;
  const nextKey = message.msgId ?? message.id;
  return previousKey === nextKey;
}

function createStableStepIdAllocator() {
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();
  return (candidate: string | null | undefined, fallback: string) => {
    const base = candidate?.trim() || fallback;
    let id = base;
    let suffix = nextSuffix.get(base) ?? 2;
    while (used.has(id)) {
      id = `${base}#${suffix}`;
      suffix += 1;
    }
    used.add(id);
    nextSuffix.set(base, suffix);
    return id;
  };
}

export function buildLocalAgentTurnPresentation(
  run: PersonalLocalAgentRunResult | null | undefined,
  timelineMessages: PersonalLocalAgentConversationMessage[],
  finalText: string,
): LocalAgentTurnPresentation {
  if (!run) {
    return {
      hasProcess: false,
      collapseEligible: false,
      durationMs: null,
      durationLabel: null,
      processSteps: [],
      alwaysVisibleSteps: [],
    };
  }
  const pendingIds = new Set((run.pendingApprovals ?? []).map((approval) => approval.id));
  const body = finalText.trim();
  const processSteps: LocalAgentTurnProcessStep[] = [];
  const alwaysVisibleSteps: LocalAgentTurnProcessStep[] = [];
  const allocateProcessStepId = createStableStepIdAllocator();
  const allocateVisibleStepId = createStableStepIdAllocator();
  let index = 0;
  for (const raw of sourceMessages(run, timelineMessages)) {
    const sanitized = raw.role === "assistant" || raw.type === "text" || raw.type === "finish"
      ? sanitizeAssistantTranscriptText(raw.text)
      : { text: raw.text, wasSkillCatalogDump: false };
    if (sanitized.wasSkillCatalogDump && !sanitized.text.trim()) continue;
    const message = sanitized.text === raw.text ? raw : { ...raw, text: sanitized.text };
    if (message.role === "user") continue;
    if (ALWAYS_VISIBLE_TYPES.has(message.type) || isPendingApproval(message, pendingIds)) {
      alwaysVisibleSteps.push({
        id: allocateVisibleStepId(message.id, `visible:${index}`),
        message,
      });
      index += 1;
      continue;
    }
    if (isFinalBodyMessage(message, body)) continue;
    const isProcessType = PROCESS_TYPES.has(message.type)
      || message.type === "permission"
      || Boolean(message.approval)
      || (message.role === "assistant" && textOf(message) && message.type !== "finish");
    if (!isProcessType) continue;
    for (const step of explodeProcessMessage(message)) {
      const previous = processSteps.at(-1)?.message;
      if (canMergeThinking(previous, step) && previous) {
        processSteps[processSteps.length - 1] = {
          id: processSteps.at(-1)!.id,
          message: {
            ...previous,
            text: `${previous.text ?? ""}${step.text ?? ""}`,
            status: step.status ?? previous.status,
          },
        };
        continue;
      }
      processSteps.push({
        id: allocateProcessStepId(step.id, `${message.id}:${index}`),
        message: step,
      });
      index += 1;
    }
  }
  const durationMs = localAgentTurnDurationMs(run);
  const terminal = TERMINAL_STATUSES.has(run.status);
  return {
    hasProcess: processSteps.length > 0,
    collapseEligible: terminal && processSteps.length > 0 && body.length > 0,
    durationMs,
    durationLabel: durationMs == null ? null : formatLocalAgentTurnDuration(durationMs),
    processSteps,
    alwaysVisibleSteps,
  };
}
