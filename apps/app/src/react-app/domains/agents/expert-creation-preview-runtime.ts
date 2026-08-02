import { createClient, unwrap } from "../../../app/lib/opencode";
import { normalizeEvent } from "../../../app/utils";
import type { AgentWizardDraft } from "./agent-registry-types";
import { buildAgentSystemPrompt, buildAgentToolAccess } from "./pending-agent-store";
import { buildExpertChatPromptParts } from "./expert-creation-chat-attachments";

export type ExpertPreviewRuntimeConfig = {
  baseUrl: string;
  token: string | null;
  workspaceRoot: string;
};

export type ExpertPreviewTurnInput = {
  config: ExpertPreviewRuntimeConfig;
  sessionId: string | null;
  message: string;
  attachments?: readonly File[];
  draft: AgentWizardDraft;
  signal?: AbortSignal;
  onTextChange?: (text: string) => void;
};

export type ExpertPreviewTurnOutput = {
  sessionId: string;
  content: string;
};

type PreviewStreamState = {
  messageRoles: Map<string, string>;
  partMessageIds: Map<string, string>;
  partTexts: Map<string, string>;
  orderedPartIds: string[];
  pendingRoleEvents: Map<string, unknown[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  if (typeof value.message === "string") return value.message;
  if ("error" in value) return readErrorMessage(value.error);
  return "";
}

function fullText(state: PreviewStreamState): string {
  return state.orderedPartIds.map((partId) => state.partTexts.get(partId) ?? "").join("");
}

function rememberPart(state: PreviewStreamState, partId: string, messageId: string): void {
  state.partMessageIds.set(partId, messageId);
  if (!state.orderedPartIds.includes(partId)) state.orderedPartIds.push(partId);
}

function queueRoleEvent(state: PreviewStreamState, messageId: string, raw: unknown): void {
  const pending = state.pendingRoleEvents.get(messageId);
  if (pending) pending.push(raw);
  else state.pendingRoleEvents.set(messageId, [raw]);
}

export function applyExpertPreviewStreamEvent(
  raw: unknown,
  sessionId: string,
  state: PreviewStreamState,
): { kind: "continue" | "done" | "error"; message?: string; text?: string } | null {
  const event = normalizeEvent(raw);
  if (!event || !isRecord(event.properties)) return null;
  if (event.type === "session.idle") {
    return event.properties.sessionID === sessionId ? { kind: "done", text: fullText(state) } : null;
  }
  if (event.type === "session.error") {
    if (event.properties.sessionID !== sessionId) return null;
    return { kind: "error", message: readErrorMessage(event.properties) || "Session failed" };
  }
  if (event.type === "message.updated") {
    const info = event.properties.info;
    if (!isRecord(info) || info.sessionID !== sessionId || typeof info.id !== "string" || typeof info.role !== "string") {
      return null;
    }
    state.messageRoles.set(info.id, info.role);
    const pending = state.pendingRoleEvents.get(info.id) ?? [];
    state.pendingRoleEvents.delete(info.id);
    let latest: { kind: "continue" | "done" | "error"; message?: string; text?: string } | null = null;
    for (const pendingRaw of pending) {
      latest = applyExpertPreviewStreamEvent(pendingRaw, sessionId, state) ?? latest;
    }
    return latest ?? { kind: "continue" };
  }
  if (event.type === "message.part.updated") {
    const part = event.properties.part;
    if (!isRecord(part) || part.sessionID !== sessionId || part.type !== "text") return null;
    if (part.synthetic === true || part.ignored === true) return null;
    if (typeof part.id !== "string" || typeof part.messageID !== "string" || typeof part.text !== "string") return null;
    if (!state.messageRoles.has(part.messageID)) {
      queueRoleEvent(state, part.messageID, raw);
      return null;
    }
    if (state.messageRoles.get(part.messageID) !== "assistant") return null;
    rememberPart(state, part.id, part.messageID);
    state.partTexts.set(part.id, part.text);
    return { kind: "continue", text: fullText(state) };
  }
  if (event.type !== "message.part.delta") return null;
  const partId = typeof event.properties.partID === "string" ? event.properties.partID : null;
  const messageId = typeof event.properties.messageID === "string" ? event.properties.messageID : null;
  const delta = typeof event.properties.delta === "string" ? event.properties.delta : "";
  const field = typeof event.properties.field === "string" ? event.properties.field : "";
  if (!partId || !messageId || !delta || field !== "text") return null;
  if (!state.messageRoles.has(messageId)) {
    queueRoleEvent(state, messageId, raw);
    return null;
  }
  if (state.messageRoles.get(messageId) !== "assistant") return null;
  rememberPart(state, partId, messageId);
  state.partTexts.set(partId, `${state.partTexts.get(partId) ?? ""}${delta}`);
  return { kind: "continue", text: fullText(state) };
}

export function createExpertPreviewStreamState(): PreviewStreamState {
  return {
    messageRoles: new Map(),
    partMessageIds: new Map(),
    partTexts: new Map(),
    orderedPartIds: [],
    pendingRoleEvents: new Map(),
  };
}

export async function runExpertPreviewTurn(input: ExpertPreviewTurnInput): Promise<ExpertPreviewTurnOutput> {
  const client = createClient(input.config.baseUrl, input.config.workspaceRoot || undefined, {
    token: input.config.token ?? undefined,
    mode: "onmyagent",
  });
  const sessionId = input.sessionId ?? unwrap(await client.session.create({
    directory: input.config.workspaceRoot || undefined,
  })).id;
  if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const subscription = await client.event.subscribe(undefined, { signal: input.signal });
  const streamState = createExpertPreviewStreamState();
  let finalText = "";
  const consume = (async () => {
    for await (const raw of subscription.stream) {
      const event = applyExpertPreviewStreamEvent(raw, sessionId, streamState);
      if (!event) continue;
      if (event.text !== undefined) {
        finalText = event.text;
        input.onTextChange?.(event.text);
      }
      if (event.kind === "error") throw new Error(event.message || "Session failed");
      if (event.kind === "done") return;
    }
  })();

  const abort = () => {
    void client.session.abort({ sessionID: sessionId, directory: input.config.workspaceRoot || undefined });
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const parts = await buildExpertChatPromptParts(input.message, input.attachments ?? []);
    const promptResult = await client.session.promptAsync({
      sessionID: sessionId,
      directory: input.config.workspaceRoot || undefined,
      system: buildAgentSystemPrompt({ ...input.draft, quote: input.draft.description }),
      tools: buildAgentToolAccess(input.draft),
      parts,
    });
    if (promptResult.error) throw new Error(readErrorMessage(promptResult.error) || "Expert preview request failed");
    await consume;
    return { sessionId, content: finalText };
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}
