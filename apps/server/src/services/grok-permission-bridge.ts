import { isAbsolute, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "../core/errors.js";
import type { ApprovalService } from "./approvals.js";
import type { PrimaryRuntimeEventBus } from "./primary-runtime-events.js";
import { GROK_QUESTION_METHODS } from "./grok-extension-registry.js";

type JsonObject = Record<string, unknown>;
type PermissionSession = {
  productSessionId: string;
  workspace: { id: string; path: string };
};
type PendingQuestionnaire = {
  runtimeSessionId: string;
  productSessionId: string;
  items: Array<{
    key: string;
    prompt: string;
    options: Array<{ optionId: string; label: string; description?: string }>;
    allowFreeText: boolean;
    multiple: boolean;
  }>;
  resolve: (value: unknown) => void;
};

export class GrokPermissionBridge {
  readonly #approvals: ApprovalService;
  readonly #events?: PrimaryRuntimeEventBus;
  readonly #sessions = new Map<string, PermissionSession>();
  readonly #questions = new Map<string, PendingQuestionnaire>();

  constructor(approvals: ApprovalService, events?: PrimaryRuntimeEventBus) {
    this.#approvals = approvals;
    this.#events = events;
  }

  bindSession(
    runtimeSessionId: string,
    productSessionId: string,
    workspace: PermissionSession["workspace"],
  ): void {
    const id = requireString(runtimeSessionId);
    this.#sessions.set(id, {
      productSessionId: requireString(productSessionId),
      workspace,
    });
  }

  unbindSession(runtimeSessionId: string): void {
    const id = runtimeSessionId.trim();
    this.#sessions.delete(id);
    for (const [questionId, question] of this.#questions) {
      if (question.runtimeSessionId !== id) continue;
      question.resolve({ outcome: "cancelled" });
      this.#questions.delete(questionId);
    }
  }

  async handle(method: string, value: unknown): Promise<unknown> {
    if (GROK_QUESTION_METHODS.includes(method as typeof GROK_QUESTION_METHODS[number])) {
      return this.#requestQuestion(value);
    }
    if (method !== "session/request_permission" && method !== "permission/request") {
      throw new ApiError(
        400,
        "grok_acp_request_unsupported",
        `Unsupported ACP request: ${method}`,
      );
    }
    const params = asObject(value);
    const runtimeSessionId = sessionIdFrom(params);
    const session = this.#sessions.get(runtimeSessionId);
    if (!session) return cancelledDecision();
    const permissionId = permissionIdFrom(params);
    const options = permissionOptions(params.options);
    if (options.length === 0) return cancelledDecision();
    this.#events?.emitForNative("grok-build", runtimeSessionId, {
      kind: "permission.requested",
      permission: {
        permissionId,
        productSessionId: session.productSessionId,
        title: permissionSummary(params),
        options: options.map((option) => ({
          optionId: option.optionId,
          label: option.label,
          kind: canonicalOptionKind(option),
        })),
        requestedAt: Date.now(),
      },
    });
    const result = await this.#approvals.requestApproval(
      {
        workspaceId: session.workspace.id,
        action: "grok_runtime_permission",
        summary: permissionSummary(params),
        paths: permissionPaths(params, session.workspace),
        actor: { type: "host", scope: "owner" },
      },
      { forceManual: true, requestId: permissionId },
    );
    const selected = selectPermissionOption(options, result.allowed);
    this.#events?.emitForNative("grok-build", runtimeSessionId, {
      kind: "permission.resolved",
      decision: selected
        ? {
            permissionId,
            outcome: "selected",
            optionId: selected,
            decidedAt: Date.now(),
          }
        : {
            permissionId,
            outcome: result.reason === "timeout" ? "timed_out" : "cancelled",
            decidedAt: Date.now(),
          },
    });
    return selected
      ? { outcome: { outcome: "selected", optionId: selected } }
      : cancelledDecision();
  }

  respondQuestion(input: {
    productSessionId: string;
    questionId: string;
    answers: string[][];
  }): void {
    const question = this.#questions.get(input.questionId.trim());
    if (!question || question.productSessionId !== input.productSessionId.trim()) {
      throw new ApiError(404, "agent_runtime_question_not_found", "Runtime question is no longer pending");
    }
    if (input.answers.length !== question.items.length) {
      throw new ApiError(400, "agent_runtime_question_answer_invalid", "Runtime question answer count is invalid");
    }
    const dismissed = input.answers.every((answer) => answer.length === 0);
    if (dismissed) {
      question.resolve({ outcome: "cancelled" });
      this.#questions.delete(input.questionId.trim());
      this.#emitQuestionResolved(question, input.questionId, []);
      return;
    }
    const answers: Record<string, string[]> = {};
    const annotations: Record<string, { notes: string }> = {};
    question.items.forEach((item, index) => {
      const raw = [...new Set((input.answers[index] ?? []).map((value) => value.trim()))];
      const allowed = new Set(item.options.map((option) => option.label));
      const selected = raw.filter((value) => allowed.has(value));
      const unknown = raw.filter((value) => !allowed.has(value));
      if (unknown.length > 0 && !item.allowFreeText) {
        throw new ApiError(
          400,
          "agent_runtime_question_answer_invalid",
          "Runtime question answer is not an available option",
        );
      }
      const notes = unknown[0];
      if (selected.length) answers[item.prompt] = item.multiple ? selected : selected.slice(0, 1);
      if (notes && item.allowFreeText) {
        answers[item.prompt] = item.multiple
          ? [...(answers[item.prompt] ?? []), "Other"]
          : ["Other"];
        annotations[item.prompt] = { notes: notes.slice(0, 4_000) };
      }
    });
    question.resolve({
      outcome: "accepted",
      answers,
      ...(Object.keys(annotations).length ? { annotations } : {}),
    });
    this.#questions.delete(input.questionId.trim());
    this.#emitQuestionResolved(question, input.questionId, input.answers.flat());
  }

  #emitQuestionResolved(
    question: PendingQuestionnaire,
    questionId: string,
    selectedOptionIds: string[],
  ): void {
    this.#events?.emitForNative("grok-build", question.runtimeSessionId, {
      kind: "question.resolved",
      answer: {
        questionId: questionId.trim(),
        selectedOptionIds,
        answeredAt: Date.now(),
      },
    });
  }

  #requestQuestion(value: unknown): Promise<unknown> {
    const outer = asObject(value);
    const params = "params" in outer && asObject(outer.params).sessionId
      ? asObject(outer.params)
      : outer;
    const runtimeSessionId = sessionIdFrom(params);
    const session = this.#sessions.get(runtimeSessionId);
    if (!session) return Promise.resolve({ outcome: "cancelled" });
    const items = questionItems(params.questions);
    if (!items.length) return Promise.resolve({ outcome: "cancelled" });
    const questionId = requireString(params.toolCallId ?? params.tool_call_id, false) || randomUUID();
    return new Promise((resolve) => {
      const previous = this.#questions.get(questionId);
      if (previous) previous.resolve({ outcome: "cancelled" });
      this.#questions.set(questionId, {
        runtimeSessionId,
        productSessionId: session.productSessionId,
        items,
        resolve,
      });
      const first = items[0]!;
      this.#events?.emitForNative("grok-build", runtimeSessionId, {
        kind: "question.requested",
        question: {
          questionId,
          productSessionId: session.productSessionId,
          prompt: first.prompt,
          options: first.options,
          allowFreeText: first.allowFreeText,
          items,
          requestedAt: Date.now(),
        },
      });
    });
  }
}

function questionItems(value: unknown): PendingQuestionnaire["items"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry, index) => {
    const question = asObject(entry);
    const prompt = requireString(question.question ?? question.prompt, false).slice(0, 4_000);
    if (!prompt) return [];
    const options = Array.isArray(question.options)
      ? question.options.slice(0, 50).flatMap((raw, optionIndex) => {
          const option = asObject(raw);
          const label = requireString(option.label, false).slice(0, 500);
          if (!label) return [];
          return [{
            optionId: requireString(option.id, false) || `option-${optionIndex + 1}`,
            label,
            ...(typeof option.description === "string" && option.description.trim()
              ? { description: option.description.trim().slice(0, 2_000) }
              : {}),
          }];
        })
      : [];
    return [{
      key: requireString(question.id, false) || `question-${index + 1}`,
      prompt,
      options,
      allowFreeText: question.custom !== false,
      multiple: question.multiSelect === true || question.multiple === true,
    }];
  });
}

function permissionOptions(value: unknown): Array<{
  optionId: string;
  label: string;
  kind: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const option = asObject(item);
    const optionId = requireString(option.optionId ?? option.id, false);
    if (!optionId) return [];
    return [{
      optionId,
      label: requireString(option.name ?? option.label, false) || optionId,
      kind: requireString(option.kind, false).toLowerCase(),
    }];
  });
}

function selectPermissionOption(
  options: Array<{ optionId: string; kind: string }>,
  allowed: boolean,
): string | null {
  const patterns = allowed
    ? [/allow_once/i, /^allow$/i, /accept/i, /approve/i]
    : [/reject_once/i, /^reject/i, /^deny/i, /decline/i];
  const match = options.find((option) =>
    patterns.some((pattern) =>
      pattern.test(option.kind) || pattern.test(option.optionId),
    ),
  );
  return match?.optionId ?? null;
}

function canonicalOptionKind(
  option: { optionId: string; kind: string },
): "allow_once" | "allow_always" | "reject_once" | "reject_always" {
  const value = `${option.kind} ${option.optionId}`;
  if (/allow_always|always_allow/i.test(value)) return "allow_always";
  if (/reject_always|always_reject|deny_always/i.test(value)) return "reject_always";
  if (/allow|accept|approve/i.test(value)) return "allow_once";
  return "reject_once";
}

function permissionIdFrom(params: JsonObject): string {
  return requireString(
    params.permissionId ?? params.permission_id ?? params.id,
    false,
  ) || randomUUID();
}

function permissionSummary(params: JsonObject): string {
  for (const value of [params.title, params.toolName, params.permission]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  return "Grok Build requested permission to continue";
}

function permissionPaths(
  params: JsonObject,
  workspace: PermissionSession["workspace"],
): string[] {
  const candidate = typeof params.cwd === "string"
    ? params.cwd.trim()
    : typeof asObject(params.input).cwd === "string"
      ? String(asObject(params.input).cwd).trim()
      : "";
  if (!candidate || !isAbsolute(candidate)) return [];
  const child = relative(workspace.path, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child))
    ? [candidate]
    : [];
}

function sessionIdFrom(params: JsonObject): string {
  return requireString(params.sessionId ?? params.session_id);
}

function cancelledDecision(): { outcome: { outcome: "cancelled" } } {
  return { outcome: { outcome: "cancelled" } };
}

function requireString(value: unknown, required = true): string {
  const resolved = typeof value === "string" ? value.trim() : "";
  if (!resolved && required) {
    throw new ApiError(
      400,
      "grok_acp_permission_invalid",
      "Grok permission request is missing a session id",
    );
  }
  return resolved;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}
