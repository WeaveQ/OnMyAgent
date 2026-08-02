import { createClient, unwrap } from "../../../app/lib/opencode";
import { normalizeEvent } from "../../../app/utils";
import type { AgentSkillItem, AgentWizardDraft } from "./agent-registry-types";
import {
  buildExpertCoachSystemPrompt,
  EXPERT_COACH_OUTPUT_FORMAT,
  parseExpertCoachTurnResult,
  type ExpertCoachTurnResult,
} from "./expert-creation-coach-model";

const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

export type ExpertCoachRuntimeConfig = {
  baseUrl: string;
  token: string | null;
  workspaceRoot: string;
};

export type ExpertCoachRuntimeEvent =
  | { kind: "result"; result: ExpertCoachTurnResult }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type ExpertCoachTurnInput = {
  config: ExpertCoachRuntimeConfig;
  sessionId: string | null;
  message: string;
  draft: AgentWizardDraft;
  skills: readonly AgentSkillItem[];
  signal?: AbortSignal;
};

export type ExpertCoachTurnOutput = {
  sessionId: string;
  result: ExpertCoachTurnResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  if (typeof value.message === "string") return value.message;
  if (typeof value.name === "string") return value.name;
  if ("error" in value) return readErrorMessage(value.error);
  return "";
}

export function readExpertCoachRuntimeEvent(raw: unknown, sessionId: string): ExpertCoachRuntimeEvent | null {
  const event = normalizeEvent(raw);
  if (!event || !isRecord(event.properties)) return null;

  if (event.type === "session.idle") {
    return event.properties.sessionID === sessionId ? { kind: "done" } : null;
  }

  if (event.type === "session.error") {
    if (event.properties.sessionID !== sessionId) return null;
    return {
      kind: "error",
      message: readErrorMessage(event.properties.error) || readErrorMessage(event.properties) || "Session failed",
    };
  }

  if (event.type !== "message.part.updated") return null;
  const part = event.properties.part;
  if (!isRecord(part) || part.sessionID !== sessionId || part.type !== "tool" || part.tool !== STRUCTURED_OUTPUT_TOOL) {
    return null;
  }
  if (!isRecord(part.state) || part.state.status !== "completed") return null;
  const result = parseExpertCoachTurnResult(part.state.input);
  return result ? { kind: "result", result } : null;
}

function errorFromResult(error: unknown): Error {
  return new Error(readErrorMessage(error) || "Expert coach request failed");
}

export async function runExpertCoachTurn(input: ExpertCoachTurnInput): Promise<ExpertCoachTurnOutput> {
  const client = createClient(input.config.baseUrl, input.config.workspaceRoot || undefined, {
    token: input.config.token ?? undefined,
    mode: "onmyagent",
  });
  const sessionId = input.sessionId ?? unwrap(await client.session.create({
    directory: input.config.workspaceRoot || undefined,
  })).id;

  if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const subscription = await client.event.subscribe(undefined, { signal: input.signal });
  let structuredResult: ExpertCoachTurnResult | null = null;
  const consume = (async () => {
    for await (const raw of subscription.stream) {
      const event = readExpertCoachRuntimeEvent(raw, sessionId);
      if (!event) continue;
      if (event.kind === "result") {
        structuredResult = event.result;
        continue;
      }
      if (event.kind === "error") throw new Error(event.message);
      if (event.kind === "done") return;
    }
  })();

  const abort = () => {
    void client.session.abort({
      sessionID: sessionId,
      directory: input.config.workspaceRoot || undefined,
    });
  };
  input.signal?.addEventListener("abort", abort, { once: true });

  try {
    const promptResult = await client.session.promptAsync({
      sessionID: sessionId,
      directory: input.config.workspaceRoot || undefined,
      system: buildExpertCoachSystemPrompt(input.draft, input.skills),
      format: EXPERT_COACH_OUTPUT_FORMAT,
      parts: [{ type: "text", text: input.message }],
    });
    if (promptResult.error) throw errorFromResult(promptResult.error);
    await consume;
    if (!structuredResult) throw new Error("Expert coach returned no structured result");
    return { sessionId, result: structuredResult };
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}
