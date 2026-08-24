import type {
  PersonalLocalAgentConversationMessage,
  PersonalLocalAgentConversationStatusResult,
  PersonalLocalAgentRunEvent,
  PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";
import type { ChatMessage } from "../messages/message-types";

const HIDDEN_HISTORY_MESSAGE_TYPES = new Set([
  "agent_status",
  "available_commands",
  "context_usage",
]);
const ASSISTANT_HISTORY_BODY_TYPES = new Set(["text", "content", "finish", "assistant"]);

type ConversationMessageTurn = {
  user: PersonalLocalAgentConversationMessage | null;
  messages: PersonalLocalAgentConversationMessage[];
};

function assistantText(messages: readonly PersonalLocalAgentConversationMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant" || !message.text.trim()) continue;
    if (!ASSISTANT_HISTORY_BODY_TYPES.has(String(message.type ?? "text"))) continue;
    return message.text;
  }
  return "";
}

function historyRun(
  chatKey: string,
  turn: number,
  messages: PersonalLocalAgentConversationMessage[],
  events: PersonalLocalAgentRunEvent[],
  activeRun: PersonalLocalAgentRunResult | null,
  isLastTurn: boolean,
): PersonalLocalAgentRunResult {
  if (activeRun && isLastTurn) {
    return {
      ...activeRun,
      events: activeRun.events.length ? activeRun.events : events,
      conversationMessages: messages,
    };
  }
  const startedAt = Number(events.find((event) => event.type === "user")?.at)
    || Number(messages[0]?.createdAt)
    || Date.now();
  const finishedAt = Number(events.at(-1)?.at)
    || Number(messages.at(-1)?.createdAt)
    || startedAt;
  const failed = messages.some((message) => message.type === "error")
    || events.some((event) => event.type === "error");
  return {
    ok: !failed,
    runId: `history-${chatKey}-run-${turn}`,
    agentId: chatKey.split("::")[0] ?? chatKey,
    status: failed ? "failed" : "completed",
    startedAt,
    finishedAt,
    pid: null,
    command: "history",
    output: assistantText(messages),
    error: failed ? messages.findLast((message) => message.type === "error")?.text ?? null : null,
    events,
    eventRevision: events.length,
    conversationMessages: messages,
    logPath: null,
    // A pending approval belongs only to the active turn. Reusing it on a
    // synthetic historical run would render the same approval card on every
    // earlier assistant turn.
    pendingApprovals: [],
  };
}

function conversationEventsByTurn(events: readonly PersonalLocalAgentRunEvent[]) {
  const turns: PersonalLocalAgentRunEvent[][] = [];
  let current: PersonalLocalAgentRunEvent[] = [];
  for (const event of events) {
    if (event.type === "user") {
      if (current.some((item) => item.type === "user")) turns.push(current);
      current = [event];
      continue;
    }
    if (current.length) current.push(event);
  }
  if (current.length) turns.push(current);
  return turns;
}

function alignEventTurns(
  turns: readonly ConversationMessageTurn[],
  eventTurns: readonly PersonalLocalAgentRunEvent[][],
) {
  const aligned = turns.map(() => [] as PersonalLocalAgentRunEvent[]);
  let eventIndex = eventTurns.length - 1;
  for (let turnIndex = turns.length - 1; turnIndex >= 0 && eventIndex >= 0; turnIndex -= 1) {
    const userMessage = turns[turnIndex]?.user;
    const events = eventTurns[eventIndex] ?? [];
    const userEvent = events.find((event) => event.type === "user");
    if (!userMessage || !userEvent) continue;
    if (
      userMessage.text.trim() !== userEvent.text.trim()
      || Number(userMessage.createdAt) !== Number(userEvent.at)
    ) continue;
    aligned[turnIndex] = events;
    eventIndex -= 1;
  }
  return aligned;
}

export function conversationStatusToChatMessages(
  chatKey: string,
  result: PersonalLocalAgentConversationStatusResult,
): ChatMessage[] {
  const turns: ConversationMessageTurn[] = [];
  let current = { user: null as PersonalLocalAgentConversationMessage | null, messages: [] as PersonalLocalAgentConversationMessage[] };
  for (const message of result.conversationMessages ?? []) {
    if (message.role === "user") {
      if (current.user || current.messages.length) turns.push(current);
      current = { user: message, messages: [] };
    } else {
      current.messages.push(message);
    }
  }
  if (current.user || current.messages.length) turns.push(current);
  const eventTurns = conversationEventsByTurn(result.events ?? []);
  const alignedEventTurns = alignEventTurns(turns, eventTurns);

  return turns.flatMap((turn, index) => {
    const entries: ChatMessage[] = [];
    if (turn.user) {
      entries.push({
        id: `history-${chatKey}-user-${turn.user.id ?? index}`,
        role: "user",
        text: turn.user.text,
        createdAt: Number(turn.user.createdAt) || Date.now() + index,
      });
    }
    const ownsActiveRun = Boolean(result.activeRun && index === turns.length - 1);
    if (
      ownsActiveRun
      || turn.messages.some((message) => !HIDDEN_HISTORY_MESSAGE_TYPES.has(String(message.type ?? "")))
    ) {
      const run = historyRun(
        chatKey,
        index,
        turn.messages,
        alignedEventTurns[index] ?? [],
        result.activeRun,
        index === turns.length - 1,
      );
      entries.push({
        id: `history-${chatKey}-assistant-${turn.messages[0]?.id ?? index}`,
        role: "assistant",
        text: assistantText(turn.messages),
        createdAt: run.startedAt,
        run,
      });
    }
    return entries;
  });
}

function isHydratedMessage(message: ChatMessage) {
  return message.id.startsWith("history-") || message.id.startsWith("native-session-");
}

function sameCanonicalMessage(left: ChatMessage, right: ChatMessage) {
  if (left.role !== right.role || left.text.trim() !== right.text.trim()) return false;
  return Math.abs(left.createdAt - right.createdAt) <= 1_000;
}

/**
 * Replace old hydrated rows with canonical history without dropping a prompt
 * entered while the async history request was still resolving. The currently
 * streaming run stays renderer-newer than the status snapshot.
 */
export function mergeHydratedChatMessages(
  current: ChatMessage[],
  canonical: ChatMessage[],
  activeRunId: string | null,
): ChatMessage[] {
  const welcome = current.filter((message) => message.id.startsWith("welcome-"));
  const active = activeRunId
    ? current.filter((message) => message.run?.runId === activeRunId)
    : [];
  const activeRunIds = new Set(active.flatMap((message) => message.run?.runId ? [message.run.runId] : []));
  const history = canonical.filter((message) => !message.run?.runId || !activeRunIds.has(message.run.runId));
  const represented = new Set<number>();
  const transient = current.filter((message) =>
    !message.id.startsWith("welcome-")
    && !isHydratedMessage(message)
    && !active.includes(message),
  ).filter((message) => {
    const match = history.findIndex((candidate, index) =>
      !represented.has(index) && sameCanonicalMessage(message, candidate),
    );
    if (match < 0) return true;
    represented.add(match);
    return false;
  });
  return [...welcome, ...history, ...transient, ...active];
}
