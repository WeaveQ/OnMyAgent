import {
  parseExpertDraftSuggestion,
  type ExpertDraftSuggestion,
} from "../../agents";

export type ExpertCreationCoachMessage = {
  info: {
    id: string;
    role: string;
    time: {
      created: number;
      completed?: number;
    };
  };
  parts: readonly unknown[];
};

export type ExpertCreationCoachSuggestion = {
  messageId: string;
  suggestion: ExpertDraftSuggestion;
};

export type WaitForExpertCreationSuggestionInput = {
  readMessages: () => Promise<readonly ExpertCreationCoachMessage[]>;
  baselineAssistantMessageIds: ReadonlySet<string>;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  pollIntervalMs?: number;
};

const DEFAULT_MAX_ATTEMPTS = 60;
const DEFAULT_POLL_INTERVAL_MS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAssistantTextParts(parts: readonly unknown[]): string {
  return parts
    .filter(
      (part): part is { type: "text"; text: string; ignored?: boolean } =>
        isRecord(part) &&
        part.type === "text" &&
        typeof part.text === "string" &&
        part.ignored !== true,
    )
    .map((part) => part.text)
    .join("");
}

function readLatestNewAssistantMessage(
  messages: readonly ExpertCreationCoachMessage[],
  baselineAssistantMessageIds: ReadonlySet<string>,
): {
  messageId: string;
  content: string;
  completed: boolean;
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.info.role !== "assistant") continue;
    if (baselineAssistantMessageIds.has(message.info.id)) continue;
    return {
      messageId: message.info.id,
      content: readAssistantTextParts(message.parts),
      completed: typeof message.info.time.completed === "number",
    };
  }
  return null;
}

export async function waitForExpertCreationSuggestion(
  input: WaitForExpertCreationSuggestionInput,
): Promise<ExpertCreationCoachSuggestion | null> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const pollIntervalMs = Math.max(
    0,
    input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const messages = await input.readMessages();
    const latest = readLatestNewAssistantMessage(
      messages,
      input.baselineAssistantMessageIds,
    );
    if (latest) {
      const parsed = parseExpertDraftSuggestion(latest.content);
      if (parsed.suggestion) {
        return {
          messageId: latest.messageId,
          suggestion: parsed.suggestion,
        };
      }
      if (latest.completed) return null;
    }
    if (attempt + 1 < maxAttempts) await sleep(pollIntervalMs);
  }
  return null;
}
