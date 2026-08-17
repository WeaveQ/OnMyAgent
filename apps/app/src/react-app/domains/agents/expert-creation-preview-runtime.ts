import { createClient, unwrap } from "../../../app/lib/opencode";
import { normalizeEvent } from "../../../app/utils";
import type { AgentWizardDraft } from "./agent-registry-types";
import type { ModelRef } from "../../../app/types";
import {
  buildAgentSystemPrompt,
  buildAgentToolAccess,
  type AgentToolAccessMap,
} from "./pending-agent-store";
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
  knowledgePaths?: readonly string[];
  model?: ModelRef;
  systemPrompt?: string;
  /** When set (including empty map), overrides draft-based tool access. */
  tools?: AgentToolAccessMap;
  signal?: AbortSignal;
  onPromptAccepted?: () => void;
  onTextChange?: (text: string) => void;
};

export type ExpertPreviewTurnOutput = {
  sessionId: string;
  content: string;
};

type PreviewStreamState = {
  messageRoles: Map<string, string>;
  partMessageIds: Map<string, string>;
  partKinds: Map<string, "text" | "reasoning">;
  partTexts: Map<string, string>;
  orderedPartIds: string[];
  pendingRoleEvents: Map<string, unknown[]>;
  pendingPartDeltas: Map<string, { messageId: string; text: string }>;
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

export function readLatestExpertPreviewReply(value: unknown): string {
  if (!Array.isArray(value)) return "";
  for (let messageIndex = value.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = value[messageIndex];
    if (!isRecord(message) || !isRecord(message.info) || message.info.role !== "assistant") continue;
    if (!Array.isArray(message.parts)) continue;
    const text = message.parts
      .filter((part) => (
        isRecord(part) &&
        part.type === "text" &&
        part.synthetic !== true &&
        part.ignored !== true &&
        typeof part.text === "string"
      ))
      .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

export function buildExpertPreviewSystemPrompt(
  draft: AgentWizardDraft,
  knowledgePaths: readonly string[],
): string {
  const base = buildAgentSystemPrompt({ ...draft, quote: draft.description });
  const paths = knowledgePaths.map((path) => path.trim()).filter(Boolean);
  if (paths.length === 0) return base;
  const knowledge = [
    "[Expert knowledge] The following files belong to this expert's private knowledge library.",
    "Use them as background when relevant. Read their contents with the available filesystem tools before answering when the question depends on them.",
    ...paths.map((path) => `- ${path}`),
  ].join("\n");
  return [base, knowledge].filter(Boolean).join("\n\n");
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
  if (event.type === "session.status") {
    if (event.properties.sessionID !== sessionId) return null;
    const status = event.properties.status;
    return isRecord(status) && status.type === "idle"
      ? { kind: "done", text: fullText(state) }
      : null;
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
    if (
      !isRecord(part) ||
      part.sessionID !== sessionId ||
      (part.type !== "text" && part.type !== "reasoning") ||
      typeof part.id !== "string" ||
      typeof part.messageID !== "string" ||
      typeof part.text !== "string"
    ) return null;
    state.partKinds.set(part.id, part.type);
    if (part.type === "reasoning") {
      state.pendingPartDeltas.delete(part.id);
      return null;
    }
    if (part.synthetic === true || part.ignored === true) return null;
    if (!state.messageRoles.has(part.messageID)) {
      queueRoleEvent(state, part.messageID, raw);
      return null;
    }
    if (state.messageRoles.get(part.messageID) !== "assistant") return null;
    rememberPart(state, part.id, part.messageID);
    const pending = state.pendingPartDeltas.get(part.id)?.text ?? "";
    state.pendingPartDeltas.delete(part.id);
    const current = state.partTexts.get(part.id) ?? "";
    state.partTexts.set(
      part.id,
      [current, pending, part.text].reduce((longest, candidate) => (
        candidate.length > longest.length ? candidate : longest
      ), ""),
    );
    return { kind: "continue", text: fullText(state) };
  }
  if (event.type !== "message.part.delta") return null;
  const partId = typeof event.properties.partID === "string" ? event.properties.partID : null;
  const messageId = typeof event.properties.messageID === "string" ? event.properties.messageID : null;
  const delta = typeof event.properties.delta === "string" ? event.properties.delta : "";
  const field = typeof event.properties.field === "string" ? event.properties.field : "";
  const eventSessionId = typeof event.properties.sessionID === "string" ? event.properties.sessionID : null;
  if (!partId || !messageId || !delta || field !== "text" || eventSessionId !== sessionId) return null;
  const partKind = state.partKinds.get(partId);
  if (!partKind) {
    const pending = state.pendingPartDeltas.get(partId);
    state.pendingPartDeltas.set(partId, {
      messageId,
      text: `${pending?.text ?? ""}${delta}`,
    });
    return null;
  }
  if (partKind === "reasoning") return null;
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
    partKinds: new Map(),
    partTexts: new Map(),
    orderedPartIds: [],
    pendingRoleEvents: new Map(),
    pendingPartDeltas: new Map(),
  };
}

export function createExpertPreviewAcceptanceGate(): {
  accept: () => void;
  waitForSubmission: (turn: Promise<unknown>) => Promise<void>;
} {
  let resolveAccepted: (() => void) | null = null;
  const accepted = new Promise<void>((resolve) => {
    resolveAccepted = resolve;
  });
  return {
    accept: () => resolveAccepted?.(),
    waitForSubmission: async (turn) => {
      await Promise.race([accepted, turn.then(() => undefined)]);
    },
  };
}

export async function submitExpertPreviewTurn<T>(input: {
  turn: Promise<T>;
  waitForSubmission: (turn: Promise<unknown>) => Promise<void>;
  onSettled: () => void | Promise<void>;
}): Promise<void> {
  const completed = input.turn.finally(input.onSettled);
  void completed.catch(() => undefined);
  await input.waitForSubmission(input.turn);
}

export function createExpertPreviewStreamLifetime(parentSignal?: AbortSignal): {
  signal: AbortSignal;
  release: () => void;
} {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });

  return {
    signal: controller.signal,
    release: () => {
      parentSignal?.removeEventListener("abort", forwardAbort);
      controller.abort();
    },
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

  const streamLifetime = createExpertPreviewStreamLifetime(input.signal);
  const abort = () => {
    void client.session.abort({ sessionID: sessionId, directory: input.config.workspaceRoot || undefined });
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const subscription = await client.event.subscribe(undefined, { signal: streamLifetime.signal });
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
    void consume.catch(() => undefined);

    const parts = await buildExpertChatPromptParts(input.message, input.attachments ?? []);
    const promptResult = await client.session.promptAsync({
      sessionID: sessionId,
      directory: input.config.workspaceRoot || undefined,
      system:
        input.systemPrompt ??
        buildExpertPreviewSystemPrompt(input.draft, input.knowledgePaths ?? []),
      tools: input.tools ?? buildAgentToolAccess(input.draft),
      ...(input.model ? { model: input.model } : {}),
      parts,
    });
    if (promptResult.error) throw new Error(readErrorMessage(promptResult.error) || "Expert preview request failed");
    input.onPromptAccepted?.();
    await consume;
    if (!finalText.trim()) {
      const messages = unwrap(await client.session.messages({
        sessionID: sessionId,
        directory: input.config.workspaceRoot || undefined,
        limit: 20,
      }));
      finalText = readLatestExpertPreviewReply(messages);
      if (finalText) input.onTextChange?.(finalText);
    }
    return { sessionId, content: finalText };
  } finally {
    input.signal?.removeEventListener("abort", abort);
    streamLifetime.release();
  }
}
