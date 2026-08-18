import { z } from "zod";
import {
  agentRuntimeIdSchema,
  agentRuntimeKindSchema,
  agentRuntimeModelRefSchema,
  agentRuntimeSessionProfileSchema,
  agentRuntimeTimestampSchema,
} from "./agent-runtime-base.js";
import type {
  AgentRuntimeKind,
  AgentRuntimeModelRef,
  AgentRuntimeSessionProfile,
} from "./agent-runtime-base.js";
import type { AgentRuntimeSelectionSnapshot } from "./agent-runtime-state.js";
export {
  agentRuntimeKindSchema,
  agentRuntimeModelRefSchema,
  type AgentRuntimeKind,
  type AgentRuntimeModelRef,
  agentRuntimeSessionProfileSchema,
  type AgentRuntimeSessionProfile,
} from "./agent-runtime-base.js";

const idSchema = agentRuntimeIdSchema;
const timestampSchema = agentRuntimeTimestampSchema;

export const agentRuntimeHealthSchema = z.enum([
  "missing",
  "process_ready",
  "needs_auth",
  "ready",
  "degraded",
  "crashed",
]);

export const agentRuntimeCapabilitySchema = z.enum([
  "session.create",
  "session.list",
  "session.load",
  "session.resume",
  "session.close",
  "session.delete",
  "turn.prompt",
  "turn.cancel",
  "config.set_model",
  "config.set_mode",
  "event.subscribe",
  "permission.respond",
  "session.rename",
  "session.fork",
  "session.revert",
  "session.unrevert",
  "session.compact",
  "turn.shell",
  "command.list",
  "command.execute",
  "mcp.administer",
  "history.read",
  "history.search",
  "usage.read",
  "question.respond",
]);

export const agentRuntimeFeatureStateSchema = z.enum([
  "supported",
  "unsupported",
  "unknown",
  "policy_blocked",
  "degraded",
]);

export const agentRuntimeFeatureSourceSchema = z.enum([
  "initialize",
  "lazy_call",
  "pinned_contract",
  "host_policy",
]);

export const agentRuntimeFeatureFactSchema = z
  .object({
    feature: agentRuntimeCapabilitySchema,
    state: agentRuntimeFeatureStateSchema,
    source: agentRuntimeFeatureSourceSchema,
  })
  .strict();

export const agentRuntimeCapabilitiesSchema = z
  .object({
    protocolVersion: z.string().trim().min(1),
    features: z.array(agentRuntimeCapabilitySchema),
    nativeVersion: z.string().trim().min(1).optional(),
    featureStates: z.array(agentRuntimeFeatureFactSchema).optional(),
  })
  .strict();

export const agentRuntimeErrorSchema = z
  .object({
    code: idSchema,
    message: z.string().min(1),
    retriable: z.boolean(),
    remediation: z.string().min(1).optional(),
    diagnosticsId: idSchema.optional(),
  })
  .strict();

export const agentRuntimeHealthSnapshotSchema = z
  .object({
    runtimeKind: agentRuntimeKindSchema,
    health: agentRuntimeHealthSchema,
    checkedAt: timestampSchema,
    capabilities: agentRuntimeCapabilitiesSchema.optional(),
    error: agentRuntimeErrorSchema.optional(),
  })
  .strict();

export const agentRuntimeConnectorIdSchema = z.enum([
  "tencent-docs",
  "baidu-drive",
  "kdocs",
  "dingtalk",
  "tencent-meeting",
]);

export const agentRuntimeConnectorToolStatusSchema = z
  .object({
    connectorId: agentRuntimeConnectorIdSchema,
    accountConnected: z.boolean(),
    toolAvailable: z.boolean(),
    reason: z.enum([
      "available",
      "account_not_connected",
      "runtime_projection_unavailable",
    ]),
  })
  .strict();

export const agentRuntimeConnectorToolsResponseSchema = z
  .object({
    runtimeKind: agentRuntimeKindSchema,
    workspaceId: idSchema,
    items: z.array(agentRuntimeConnectorToolStatusSchema),
    complete: z.boolean(),
  })
  .strict();

export const agentRuntimeModelSchema = z
  .object({
    ref: agentRuntimeModelRefSchema,
    displayName: z.string().trim().min(1),
    available: z.boolean(),
    capabilities: z
      .object({
        text: z.boolean(),
        imageInput: z.boolean(),
        tools: z.boolean(),
        reasoning: z.boolean(),
      })
      .strict(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

export const agentRuntimeStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("idle") }).strict(),
  z
    .object({
      type: z.literal("busy"),
      turnId: idSchema.optional(),
      startedAt: timestampSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("retry"),
      attempt: z.number().int().positive(),
      message: z.string().min(1),
      nextAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("blocked"),
      reason: z.string().min(1),
      remediation: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      error: agentRuntimeErrorSchema,
    })
    .strict(),
]);

export const agentRuntimePlanItemSchema = z
  .object({
    id: idSchema,
    text: z.string().min(1),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  })
  .strict();

export const agentRuntimeTodoSchema = z
  .object({
    id: idSchema,
    text: z.string().min(1),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    priority: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

export const agentRuntimeToolStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "error",
  "cancelled",
]);

export const agentRuntimeTextPartSchema = z
  .object({
    type: z.literal("text"),
    id: idSchema,
    text: z.string(),
  })
  .strict();

export const agentRuntimeReasoningPartSchema = z
  .object({
    type: z.literal("reasoning"),
    id: idSchema,
    text: z.string(),
  })
  .strict();

export const agentRuntimeToolPartSchema = z
  .object({
    type: z.literal("tool"),
    id: idSchema,
    toolCallId: idSchema,
    name: idSchema,
    status: agentRuntimeToolStatusSchema,
    input: z.json().optional(),
    output: z.json().optional(),
    error: agentRuntimeErrorSchema.optional(),
  })
  .strict();

export const agentRuntimeFilePartSchema = z
  .object({
    type: z.literal("file"),
    id: idSchema,
    name: z.string().trim().min(1),
    mimeType: z.string().trim().min(1).optional(),
    uri: z.string().trim().min(1),
  })
  .strict();

export const agentRuntimePlanPartSchema = z
  .object({
    type: z.literal("plan"),
    id: idSchema,
    items: z.array(agentRuntimePlanItemSchema),
  })
  .strict();

export const agentRuntimeTodoPartSchema = z
  .object({
    type: z.literal("todo"),
    id: idSchema,
    items: z.array(agentRuntimeTodoSchema),
  })
  .strict();

export const agentRuntimeUnknownPartSchema = z
  .object({
    type: z.literal("unknown"),
    id: idSchema,
    nativeType: idSchema,
    summary: z.string().optional(),
  })
  .strict();

export const agentRuntimePartSchema = z.discriminatedUnion("type", [
  agentRuntimeTextPartSchema,
  agentRuntimeReasoningPartSchema,
  agentRuntimeToolPartSchema,
  agentRuntimeFilePartSchema,
  agentRuntimePlanPartSchema,
  agentRuntimeTodoPartSchema,
  agentRuntimeUnknownPartSchema,
]);

export const agentRuntimeMessageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool",
]);

export const agentRuntimeMessageSchema = z
  .object({
    id: idSchema,
    productSessionId: idSchema,
    role: agentRuntimeMessageRoleSchema,
    parts: z.array(agentRuntimePartSchema),
    parentMessageId: idSchema.optional(),
    createdAt: timestampSchema,
    completedAt: timestampSchema.optional(),
    error: agentRuntimeErrorSchema.optional(),
  })
  .strict();

export const agentRuntimeSessionSchema = z
  .object({
    productSessionId: idSchema,
    runtimeKind: agentRuntimeKindSchema,
    runtimeSessionId: idSchema,
    workspaceId: idSchema,
    cwd: z.string().min(1),
    profileId: idSchema,
    title: z.string().nullable().optional(),
    parentProductSessionId: idSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    status: agentRuntimeStatusSchema,
    modelRef: agentRuntimeModelRefSchema.optional(),
    profile: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("assistant") }).strict(),
      z.object({ kind: z.literal("expert"), expertId: idSchema }).strict(),
    ]).optional(),
    mode: idSchema.optional(),
  })
  .strict();

export const agentRuntimePermissionOptionSchema = z
  .object({
    optionId: idSchema,
    label: z.string().trim().min(1),
    kind: z.enum([
      "allow_once",
      "allow_always",
      "reject_once",
      "reject_always",
    ]),
  })
  .strict();

export const agentRuntimePermissionRequestSchema = z
  .object({
    permissionId: idSchema,
    productSessionId: idSchema,
    toolCallId: idSchema.optional(),
    title: z.string().trim().min(1),
    description: z.string().optional(),
    options: z.array(agentRuntimePermissionOptionSchema).min(1),
    requestedAt: timestampSchema,
    expiresAt: timestampSchema.optional(),
  })
  .strict();

export const agentRuntimePermissionDecisionSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        permissionId: idSchema,
        outcome: z.literal("selected"),
        optionId: idSchema,
        decidedAt: timestampSchema,
      })
      .strict(),
    z
      .object({
        permissionId: idSchema,
        outcome: z.literal("cancelled"),
        decidedAt: timestampSchema,
      })
      .strict(),
    z
      .object({
        permissionId: idSchema,
        outcome: z.literal("timed_out"),
        decidedAt: timestampSchema,
      })
      .strict(),
  ],
);

export const agentRuntimeQuestionOptionSchema = z
  .object({
    optionId: idSchema,
    label: z.string().trim().min(1),
    description: z.string().optional(),
  })
  .strict();

export const agentRuntimeQuestionItemSchema = z
  .object({
    key: idSchema,
    prompt: z.string().trim().min(1).max(4_000),
    options: z.array(agentRuntimeQuestionOptionSchema).max(50),
    allowFreeText: z.boolean(),
    multiple: z.boolean(),
  })
  .strict();

export const agentRuntimeQuestionSchema = z
  .object({
    questionId: idSchema,
    productSessionId: idSchema,
    prompt: z.string().min(1),
    options: z.array(agentRuntimeQuestionOptionSchema),
    allowFreeText: z.boolean(),
    items: z.array(agentRuntimeQuestionItemSchema).min(1).max(20).optional(),
    requestedAt: timestampSchema,
  })
  .strict();

export const agentRuntimeQuestionAnswerSchema = z
  .object({
    questionId: idSchema,
    selectedOptionIds: z.array(idSchema),
    text: z.string().optional(),
    answeredAt: timestampSchema,
  })
  .strict();

export const agentRuntimeUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    modelRef: agentRuntimeModelRefSchema.optional(),
  })
  .strict();

const eventBaseShape = {
  eventId: idSchema,
  runtimeKind: agentRuntimeKindSchema,
  productSessionId: idSchema,
  emittedAt: timestampSchema,
  sequence: z.number().int().nonnegative().optional(),
  generation: z.number().int().nonnegative().optional(),
};

const runtimeEventSchema = <Kind extends string, Shape extends z.ZodRawShape>(
  kind: Kind,
  shape: Shape,
) => z.object({ ...eventBaseShape, kind: z.literal(kind), ...shape }).strict();

export const agentRuntimeEventSchema = z.discriminatedUnion("kind", [
  runtimeEventSchema("session.created", { session: agentRuntimeSessionSchema }),
  runtimeEventSchema("session.updated", { session: agentRuntimeSessionSchema }),
  runtimeEventSchema("session.deleted", { reason: z.string().optional() }),
  runtimeEventSchema("session.status", { status: agentRuntimeStatusSchema }),
  runtimeEventSchema("session.error", { error: agentRuntimeErrorSchema }),
  runtimeEventSchema("message.started", { message: agentRuntimeMessageSchema }),
  runtimeEventSchema("message.delta", {
    messageId: idSchema,
    partId: idSchema,
    delta: z.string(),
  }),
  runtimeEventSchema("message.completed", { message: agentRuntimeMessageSchema }),
  runtimeEventSchema("reasoning.delta", {
    messageId: idSchema,
    partId: idSchema,
    delta: z.string(),
  }),
  runtimeEventSchema("reasoning.completed", {
    messageId: idSchema,
    part: agentRuntimeReasoningPartSchema,
  }),
  runtimeEventSchema("tool.started", {
    messageId: idSchema.optional(),
    part: agentRuntimeToolPartSchema,
  }),
  runtimeEventSchema("tool.updated", {
    messageId: idSchema.optional(),
    part: agentRuntimeToolPartSchema,
  }),
  runtimeEventSchema("tool.completed", {
    messageId: idSchema.optional(),
    part: agentRuntimeToolPartSchema,
  }),
  runtimeEventSchema("plan.updated", { items: z.array(agentRuntimePlanItemSchema) }),
  runtimeEventSchema("todo.updated", { items: z.array(agentRuntimeTodoSchema) }),
  runtimeEventSchema("permission.requested", {
    permission: agentRuntimePermissionRequestSchema,
  }),
  runtimeEventSchema("permission.resolved", {
    decision: agentRuntimePermissionDecisionSchema,
  }),
  runtimeEventSchema("question.requested", { question: agentRuntimeQuestionSchema }),
  runtimeEventSchema("question.resolved", { answer: agentRuntimeQuestionAnswerSchema }),
  runtimeEventSchema("usage.updated", { usage: agentRuntimeUsageSchema }),
  runtimeEventSchema("turn.completed", {
    turnId: idSchema,
    outcome: z.enum(["completed", "cancelled", "error"]),
    usage: agentRuntimeUsageSchema.optional(),
    error: agentRuntimeErrorSchema.optional(),
  }),
  runtimeEventSchema("command.catalog.updated", {
    items: z.array(z.object({
      name: idSchema,
      description: z.string().optional(),
    }).strict()),
    complete: z.boolean(),
  }),
  runtimeEventSchema("runtime.unknown", {
    nativeType: idSchema,
    summary: z.string().max(200).optional(),
  }),
]);

export type AgentRuntimeHealth = z.infer<typeof agentRuntimeHealthSchema>;
export type AgentRuntimeCapability = z.infer<typeof agentRuntimeCapabilitySchema>;
export type AgentRuntimeFeatureState = z.infer<typeof agentRuntimeFeatureStateSchema>;
export type AgentRuntimeFeatureSource = z.infer<typeof agentRuntimeFeatureSourceSchema>;
export type AgentRuntimeFeatureFact = z.infer<typeof agentRuntimeFeatureFactSchema>;
export type AgentRuntimeCapabilities = z.infer<typeof agentRuntimeCapabilitiesSchema>;
export type AgentRuntimeError = z.infer<typeof agentRuntimeErrorSchema>;
export type AgentRuntimeHealthSnapshot = z.infer<typeof agentRuntimeHealthSnapshotSchema>;
export type AgentRuntimeConnectorId = z.infer<typeof agentRuntimeConnectorIdSchema>;
export type AgentRuntimeConnectorToolStatus = z.infer<typeof agentRuntimeConnectorToolStatusSchema>;
export type AgentRuntimeConnectorToolsResponse = z.infer<typeof agentRuntimeConnectorToolsResponseSchema>;
export type AgentRuntimeModel = z.infer<typeof agentRuntimeModelSchema>;
export type AgentRuntimeStatus = z.infer<typeof agentRuntimeStatusSchema>;
export type AgentRuntimePlanItem = z.infer<typeof agentRuntimePlanItemSchema>;
export type AgentRuntimeTodo = z.infer<typeof agentRuntimeTodoSchema>;
export type AgentRuntimePart = z.infer<typeof agentRuntimePartSchema>;
export type AgentRuntimeMessage = z.infer<typeof agentRuntimeMessageSchema>;
export type AgentRuntimeSession = z.infer<typeof agentRuntimeSessionSchema>;
export type AgentRuntimePermissionRequest = z.infer<typeof agentRuntimePermissionRequestSchema>;
export type AgentRuntimePermissionDecision = z.infer<typeof agentRuntimePermissionDecisionSchema>;
export type AgentRuntimeQuestion = z.infer<typeof agentRuntimeQuestionSchema>;
export type AgentRuntimeQuestionAnswer = z.infer<typeof agentRuntimeQuestionAnswerSchema>;
export type AgentRuntimeUsage = z.infer<typeof agentRuntimeUsageSchema>;
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;

export type AgentRuntimeEventSnapshot = {
  productSessionId: string;
  generation: number;
  latestSequence: number;
  events: AgentRuntimeEvent[];
  complete: boolean;
};

export type AgentRuntimeMessagesResponse = {
  productSessionId: string;
  messages: AgentRuntimeMessage[];
  /** False when an event-backed runtime replay no longer contains full history. */
  complete: boolean;
};

export type AgentRuntimeSelectionResponse = AgentRuntimeSelectionSnapshot & {
  availableRuntimeKinds: AgentRuntimeKind[];
  selectableDefaultRuntimeKinds: AgentRuntimeKind[];
  selectableWorkspaceRuntimeKinds?: AgentRuntimeKind[];
  health: Array<{
    health: AgentRuntimeHealthSnapshot;
    capabilities?: AgentRuntimeCapabilities;
  }>;
  /** Redacted sticky-binding rollout telemetry. No raw IDs, paths, or homes. */
  rollout: AgentRuntimeRolloutSnapshot;
};

export type AgentRuntimeRolloutSnapshot = {
  version: 1;
  generatedAt: number;
  sessionCount: number;
  runtimeCounts: Array<{ runtimeKind: AgentRuntimeKind; count: number }>;
  bindingSetHash: string;
  complete: boolean;
  failureCount: number;
};

export type AgentRuntimeModelCatalog = {
  runtimeKind: AgentRuntimeKind;
  profileId: string;
  workspaceId: string;
  models: AgentRuntimeModel[];
  defaultModelRef?: AgentRuntimeModelRef;
  auth: {
    state: "ready" | "needs_auth" | "unknown";
    methods: Array<{ id: string; label?: string }>;
  };
  complete: boolean;
};

export type AgentRuntimeCommand = {
  id: string;
  name: string;
  description?: string;
  inputHint?: string;
  source: "command" | "skill" | "workflow";
};

export type AgentRuntimeCommandListResponse = {
  productSessionId: string;
  items: AgentRuntimeCommand[];
  complete: boolean;
};

export type AgentRuntimeCommandInput = { arguments?: string };

export type AgentRuntimeCreateSessionInput = {
  productSessionId?: string;
  modelRef?: AgentRuntimeModelRef;
  mode?: string;
  profile?: AgentRuntimeSessionProfile;
};

export type AgentRuntimePromptPartInput =
  | { type: "text"; text: string }
  | { type: "file"; url: string; filename?: string; mime: string }
  | { type: "resource_link"; uri: string; filename?: string; mime?: string }
  | { type: "staged_file"; path: string; filename?: string; mime?: string }
  | { type: "image"; url?: string; path?: string; filename?: string; mime?: string }
  | { type: "agent"; name: string };

export type AgentRuntimePromptInput = {
  text: string;
  /** Runtime-neutral per-turn instructions. Adapters must preserve system semantics. */
  systemPrompt?: string;
  parts?: AgentRuntimePromptPartInput[];
  messageId?: string;
  agentId?: string;
  toolAccess?: Record<string, boolean>;
};
export type AgentRuntimePromptAccepted = { ok: true; turnId?: string };
export type AgentRuntimeSessionListFailure = {
  productSessionId: string;
  runtimeKind: AgentRuntimeKind;
  code: string;
};
export type AgentRuntimeSessionListResponse = {
  items: AgentRuntimeSession[];
  complete: boolean;
  failures: AgentRuntimeSessionListFailure[];
};
export * from "./agent-runtime-state.js";
