import { z } from "zod";

/**
 * Task Center v2 is deliberately not wire-compatible with the old fixed
 * fixed three-stage graph.  The store rejects version 1 records
 * explicitly instead of allowing them to be interpreted as a v2 task.
 */
export const TASK_ORCHESTRATOR_SCHEMA_VERSION = 2;
export const TASK_ORCHESTRATOR_TEMPLATE = "task-center-v2";
export const TASK_ORCHESTRATOR_LEGACY_SCHEMA_VERSION = 1;
export const TASK_ORCHESTRATOR_LEGACY_TEMPLATE = "software-delivery-v1";
/** Leaves headroom for the authenticated Supervisor response envelope. */
export const TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET = 768 * 1_024;
export const TASK_ORCHESTRATOR_EXPORT_MANIFEST_VERSION = 1;
/** Bounded below the authenticated Supervisor frame limit. */
export const TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET = 700 * 1_024;
export const TASK_ORCHESTRATOR_TURN_HISTORY_VERSION = 1;

const taskOrchestratorIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const taskOrchestratorTimestampSchema = z.number().int().nonnegative();
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const taskOrchestratorAgentProviderSchema = z.enum([
  "opencode",
  "codex",
  "claude",
  "openclaw",
  "hermes",
  "custom",
]);

export const taskOrchestratorCapabilityStateSchema = z.union([z.boolean(), z.literal("unknown")]);

export const taskOrchestratorProviderCapabilitySupportsSchema = z
  .object({
    taskMcp: taskOrchestratorCapabilityStateSchema,
    tools: taskOrchestratorCapabilityStateSchema,
    modelOverride: taskOrchestratorCapabilityStateSchema,
    approval: taskOrchestratorCapabilityStateSchema,
    fullAllow: taskOrchestratorCapabilityStateSchema,
    context: taskOrchestratorCapabilityStateSchema,
    nativeCompact: taskOrchestratorCapabilityStateSchema,
    nativeResume: taskOrchestratorCapabilityStateSchema,
    streaming: taskOrchestratorCapabilityStateSchema,
    nativeDelegationIsolated: taskOrchestratorCapabilityStateSchema.optional(),
  })
  .strict();

/**
 * Bounded, secret-free provider facts frozen with a Task Center selection.
 * Live catalog entries are intentionally not persisted here; only the
 * canonical model and capability booleans are retained for later diagnostics.
 */
export const taskOrchestratorProviderCapabilitySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestedModel: z.string().trim().min(1).max(240).nullable(),
    effectiveModel: z.string().trim().min(1).max(240).nullable(),
    modelResolution: z.enum(["catalog", "current", "requested", "none", "unavailable", "unknown"]),
    catalogRevision: z.string().trim().min(1).max(240).nullable(),
    catalogFreshness: z.enum(["fresh", "stale", "unknown"]),
    catalogObservedAt: taskOrchestratorTimestampSchema.nullable(),
    supports: taskOrchestratorProviderCapabilitySupportsSchema,
    nativeDelegationIsolated: taskOrchestratorCapabilityStateSchema.optional(),
    warnings: z.array(z.string().trim().min(1).max(400)).max(12),
  })
  .strict();

export const taskOrchestratorProviderDiagnosticsSchema = z
  .object({
    providerSessionId: z.string().trim().min(1).max(240).nullable(),
    effectiveModel: z.string().trim().min(1).max(240).nullable(),
    transport: z.string().trim().min(1).max(120).nullable(),
    connectionMode: z.string().trim().min(1).max(240).nullable(),
    requestId: z.string().trim().min(1).max(240).nullable().default(null),
    transportFallbackCount: z.number().int().nonnegative().default(0),
  })
  .strict();

/**
 * Numeric-only accounting projected from a provider result. Raw billing or
 * usage metadata is never persisted in Task Center state.
 */
export const taskOrchestratorProviderUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    costMicros: z.number().int().nonnegative().nullable(),
    observedAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorPermissionModeSchema = z.enum([
  "restricted",
  "full-allow",
]);

/**
 * Durable capability used only by Task Center runs. `full-allow` means the
 * Personal runtime may approve ordinary local operations inside this frozen
 * workspace; it is not a provider-wide bypass-permissions switch.
 */
export const taskOrchestratorPermissionGrantSchema = z
  .object({
    policyVersion: z.literal(1),
    id: taskOrchestratorIdSchema,
    mode: z.literal("full-allow"),
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    taskRevision: z.number().int().positive(),
    workspaceRoot: boundedText(4_096),
    realWorkspaceRoot: boundedText(4_096),
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    allowedProfileIds: z.array(taskOrchestratorIdSchema).min(1).max(22),
    allowedProviders: z.array(taskOrchestratorAgentProviderSchema).min(1).max(6),
    issuedAt: taskOrchestratorTimestampSchema,
    expiresAt: taskOrchestratorTimestampSchema,
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.expiresAt <= grant.issuedAt) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "Permission grant must expire after it is issued" });
    }
    if (new Set(grant.allowedProfileIds).size !== grant.allowedProfileIds.length) {
      context.addIssue({ code: "custom", path: ["allowedProfileIds"], message: "Permission grant profile ids must be unique" });
    }
    if (new Set(grant.allowedProviders).size !== grant.allowedProviders.length) {
      context.addIssue({ code: "custom", path: ["allowedProviders"], message: "Permission grant providers must be unique" });
    }
  });

/** Internal Personal runtime modes. V2 tasks only persist the user-facing mode. */
export const taskOrchestratorApprovalModeSchema = z.enum([
  "ask",
  "read-only-auto",
  "auto",
]);

export const taskOrchestratorContractFinalizationSchema = z.enum([
  "manual-confirm",
  "model-recommended-auto",
]);

/**
 * Existing v2 runs are parsed with the legacy protocol so an upgrade never
 * rewrites their completion semantics in place. Every newly frozen run uses
 * structured decisions: a provider process exiting is only a transport fact,
 * not proof that the task contract is complete.
 */
export const taskOrchestratorExecutionProtocolSchema = z.enum([
  "provider-completion-v2",
  "structured-decisions-v1",
]);

export const taskOrchestratorPrimaryDecisionKindSchema = z.enum([
  "checkpoint",
  "continue",
  "complete",
  "block",
  "realign",
]);

export const taskOrchestratorCriterionResultSchema = z
  .object({
    criterionIndex: z.number().int().min(0).max(49),
    status: z.enum(["passed", "failed"]),
    summary: boundedText(4_000),
    evidenceArtifactIds: z.array(taskOrchestratorIdSchema).max(20).default([]),
  })
  .strict();

export const taskOrchestratorPrimaryDecisionSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    attemptId: taskOrchestratorIdSchema,
    turnId: taskOrchestratorIdSchema.nullable().default(null),
    kind: taskOrchestratorPrimaryDecisionKindSchema,
    summary: boundedText(4_000),
    nextAction: z.string().trim().min(1).max(4_000).nullable(),
    acceptanceResults: z.array(taskOrchestratorCriterionResultSchema).max(50),
    createdAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorPrimaryDecisionInputSchema = z
  .object({
    summary: boundedText(4_000),
    nextAction: z.string().trim().min(1).max(4_000).nullable().optional(),
    acceptanceResults: z.array(taskOrchestratorCriterionResultSchema).max(50).default([]),
  })
  .strict();

/**
 * Independent acceptance checking is an optional policy, not a fixed
 * planner/implementer/verifier graph.  The default keeps the primary as the
 * sole completion authority.  When enabled, the checker profile is frozen
 * with the task and may only be used for read-only verification.
 */
export const taskOrchestratorIndependentCheckerModeSchema = z.enum([
  "primary-only",
  "independent",
]);

export const taskOrchestratorCheckerProfileSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    label: boundedText(120),
    runtime: z.literal("personal-local-agent"),
    agentId: taskOrchestratorIdSchema,
    provider: taskOrchestratorAgentProviderSchema,
    model: z.string().trim().min(1).max(240).nullable(),
    modelLabel: z.string().trim().min(1).max(240).nullable(),
    catalogSource: z.literal("personal-registry"),
    catalogRevision: z.string().trim().min(1).max(240).nullable(),
    capabilitySnapshot: taskOrchestratorProviderCapabilitySnapshotSchema.nullable().default(null),
    instructions: z.string().trim().max(12_000).default(""),
    approvalMode: taskOrchestratorApprovalModeSchema.default("read-only-auto"),
    sessionStrategy: z.literal("fresh"),
    timeoutMs: z.number().int().min(1_000).max(14_400_000),
  })
  .strict();

export const taskOrchestratorIndependentCheckerPolicySchema = z
  .object({
    mode: taskOrchestratorIndependentCheckerModeSchema.default("primary-only"),
    profile: taskOrchestratorCheckerProfileSchema.nullable().default(null),
    maxRounds: z.number().int().min(1).max(3).default(1),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.mode === "independent" && policy.profile === null) {
      context.addIssue({ code: "custom", path: ["profile"], message: "Independent checker mode requires a frozen checker profile" });
    }
    if (policy.mode === "primary-only" && policy.profile !== null) {
      context.addIssue({ code: "custom", path: ["profile"], message: "Primary-only checker mode must not carry a checker profile" });
    }
  });

export const taskOrchestratorCheckerAttemptStatusSchema = z.enum([
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

export const taskOrchestratorCheckerAttemptSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    profileId: taskOrchestratorIdSchema,
    turnId: taskOrchestratorIdSchema,
    primaryDecisionId: taskOrchestratorIdSchema,
    round: z.number().int().min(1).max(3),
    status: taskOrchestratorCheckerAttemptStatusSchema,
    leaseId: taskOrchestratorIdSchema.nullable(),
    personalRunId: z.string().trim().min(1).max(240).nullable(),
    conversationId: z.string().trim().min(1).max(240).nullable(),
    providerDiagnostics: taskOrchestratorProviderDiagnosticsSchema.nullable().default(null),
    providerUsage: taskOrchestratorProviderUsageSchema.nullable().default(null),
    prompt: z.string().max(24_000),
    outputArtifactIds: z.array(taskOrchestratorIdSchema).max(50),
    timeoutMs: z.number().int().min(1_000).max(14_400_000),
    startedAt: taskOrchestratorTimestampSchema.nullable(),
    progressAt: taskOrchestratorTimestampSchema.nullable().default(null),
    notBefore: taskOrchestratorTimestampSchema.nullable().default(null),
    updatedAt: taskOrchestratorTimestampSchema,
    finishedAt: taskOrchestratorTimestampSchema.nullable(),
    error: z.string().max(8_000).nullable(),
  })
  .strict();

export const taskOrchestratorCheckerCriterionResultSchema = z
  .object({
    criterionIndex: z.number().int().min(0).max(49),
    status: z.enum(["passed", "failed"]),
    summary: boundedText(4_000),
    evidenceArtifactIds: z.array(taskOrchestratorIdSchema).max(20),
  })
  .strict();

export const taskOrchestratorCheckerVerdictSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    runId: taskOrchestratorIdSchema,
    primaryDecisionId: taskOrchestratorIdSchema,
    checkerAttemptId: taskOrchestratorIdSchema,
    round: z.number().int().min(1).max(3),
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    verdict: z.enum(["approve", "revise", "block"]),
    summary: boundedText(4_000),
    criterionResults: z.array(taskOrchestratorCheckerCriterionResultSchema).max(50),
    evidenceArtifactIds: z.array(taskOrchestratorIdSchema).max(100),
    feedback: z.string().trim().max(8_000).nullable(),
    createdAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorSideEffectIdempotencySchema = z.enum([
  "read-only",
  "idempotent",
  "non-idempotent",
  "unknown",
]);

export const taskOrchestratorSideEffectReceiptStatusSchema = z.enum([
  "not-started",
  "unknown",
  "completed",
  "failed",
  "cancelled",
]);

export const taskOrchestratorSideEffectIntentSourceSchema = z.enum([
  "pre-execute",
  "observed-terminal",
]);

export const taskOrchestratorSideEffectSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    attemptId: taskOrchestratorIdSchema,
    toolCallId: z.string().trim().min(1).max(240),
    operation: boundedText(240),
    idempotency: taskOrchestratorSideEffectIdempotencySchema,
    intentHash: z.string().regex(/^[a-f0-9]{64}$/),
    intentAt: taskOrchestratorTimestampSchema,
    // Legacy rows cannot prove that they came from the pre-execute hook.
    // Preserve parse compatibility while conservatively withholding that
    // capability instead of guessing that execution was durably authorized.
    intentSource: taskOrchestratorSideEffectIntentSourceSchema.default("observed-terminal"),
    receiptStatus: taskOrchestratorSideEffectReceiptStatusSchema,
    receiptAt: taskOrchestratorTimestampSchema.nullable(),
    resultHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    turnId: taskOrchestratorIdSchema.nullable().default(null),
  })
  .strict();

export const TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS = Object.freeze({
  deadlineAt: null,
  maxElapsedMs: 86_400_000,
  maxPrimaryTurns: 24,
  maxWorkerAttempts: 100,
  maxWorkerConcurrency: 3,
  maxConsecutiveFailures: 3,
  contextRolloverPercent: 80,
  stallTimeoutMs: 900_000,
  maxTurnRuntimeMs: 7_200_000,
  maxTransportRetries: 3,
  maxTokens: null,
  maxCostMicros: null,
  completionAuthority: "model-recommended",
});

export const taskOrchestratorCompletionAuthoritySchema = z.enum([
  "model-recommended",
  "user-confirm",
]);

export const taskOrchestratorEndConditionsSchema = z
  .object({
    deadlineAt: taskOrchestratorTimestampSchema.nullable().default(null),
    maxElapsedMs: z.number().int().min(60_000).max(604_800_000).nullable().default(86_400_000),
    maxPrimaryTurns: z.number().int().min(1).max(100).default(24),
    maxWorkerAttempts: z.number().int().min(0).max(500).default(100),
    maxWorkerConcurrency: z.number().int().min(1).max(20).default(3),
    maxConsecutiveFailures: z.number().int().min(1).max(20).default(3),
    contextRolloverPercent: z.number().int().min(50).max(95).default(80),
    stallTimeoutMs: z.number().int().min(60_000).max(14_400_000).default(900_000),
    maxTurnRuntimeMs: z.number().int().min(60_000).max(14_400_000).default(7_200_000),
    maxTransportRetries: z.number().int().min(0).max(10).default(3),
    maxTokens: z.number().int().min(1_000).max(2_000_000_000).nullable().default(null),
    maxCostMicros: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
    completionAuthority: taskOrchestratorCompletionAuthoritySchema.default("model-recommended"),
  })
  .strict()
  .default(TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS);

export const taskOrchestratorContextUsageSourceSchema = z.enum([
  "runtime",
  "catalog",
  "table",
  "default",
  "unknown",
]);

export const taskOrchestratorContextUsageSchema = z
  .object({
    usedTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().positive().nullable(),
    percent: z.number().min(0).max(100).nullable(),
    source: taskOrchestratorContextUsageSourceSchema,
    modelId: z.string().trim().min(1).max(240).nullable(),
    observedAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorTurnStatusSchema = z.enum([
  "pending",
  "running",
  "checkpointing",
  "paused",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

export const taskOrchestratorTurnReasonSchema = z.enum([
  "initial",
  "primary-continue",
  "primary-checkpoint",
  "context-rollover",
  "user-resume",
  "app-quit-resume",
  "supervisor-recovery",
  "retry",
  "transport-retry",
]);

export const taskOrchestratorContinuationCapsuleSchema = z
  .object({
    capsuleVersion: z.literal(1).default(1),
    id: taskOrchestratorIdSchema,
    fromTurnId: taskOrchestratorIdSchema,
    taskId: taskOrchestratorIdSchema.nullable().default(null),
    taskRunId: taskOrchestratorIdSchema.nullable().default(null),
    taskRevision: z.number().int().positive().nullable().default(null),
    contractHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
    workspaceRootHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
    summary: boundedText(12_000),
    completed: z.array(boundedText(2_000)).max(50),
    pending: z.array(boundedText(2_000)).max(50),
    risks: z.array(boundedText(2_000)).max(50),
    artifactIds: z.array(taskOrchestratorIdSchema).max(100),
    workspaceEvidence: z
      .array(z.object({
        artifactId: taskOrchestratorIdSchema,
        attemptId: taskOrchestratorIdSchema,
        kind: boundedText(80),
        evidenceCount: z.number().int().nonnegative(),
        // Empty defaults preserve capsules created before durable evidence
        // excerpts were introduced. New capsules populate these fields from
        // committed artifacts, but legacy history must remain readable.
        summary: z.string().trim().max(240).default(""),
        contentExcerpt: z.string().trim().max(2_000).default(""),
        evidenceLabels: z.array(boundedText(240)).max(8).default([]),
      }).strict())
      .max(100)
      .default([]),
    acceptanceResults: z.array(taskOrchestratorCriterionResultSchema).max(50).default([]),
    workerMail: z
      .array(z.object({
        attemptId: taskOrchestratorIdSchema,
        profileId: taskOrchestratorIdSchema,
        status: z.enum(["pending", "ready", "running", "waiting-approval", "succeeded", "failed", "blocked", "cancelled"]),
        summary: z.string().max(2_000),
        artifactIds: z.array(taskOrchestratorIdSchema).max(50),
      }).strict())
      .max(100)
      .default([]),
    remainingBudget: z
      .object({
        primaryTurns: z.number().int().nonnegative(),
        workerAttempts: z.number().int().nonnegative(),
        elapsedMs: z.number().int().nonnegative().nullable(),
        tokens: z.number().int().nonnegative().nullable(),
        costMicros: z.number().int().nonnegative().nullable(),
        deadlineAt: taskOrchestratorTimestampSchema.nullable(),
      })
      .strict()
      .nullable()
      .default(null),
    unresolvedSideEffects: z
      .array(z.object({
        id: taskOrchestratorIdSchema,
        operation: boundedText(240),
        idempotency: taskOrchestratorSideEffectIdempotencySchema,
        receiptStatus: taskOrchestratorSideEffectReceiptStatusSchema,
      }).strict())
      .max(100)
      .default([]),
    nextAction: z.string().trim().min(1).max(4_000).nullable().default(null),
    lastDecisionId: taskOrchestratorIdSchema.nullable(),
    context: taskOrchestratorContextUsageSchema.nullable(),
    createdAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorCheckpointTriggerSchema = z.enum([
  "primary-decision",
  "context-threshold",
  "user-pause",
  "app-quit",
  "supervisor-restart",
  "retry",
]);

export const taskOrchestratorCheckpointSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    turnId: taskOrchestratorIdSchema,
    capsuleId: taskOrchestratorIdSchema,
    trigger: taskOrchestratorCheckpointTriggerSchema,
    createdAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorTurnSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    sequence: z.number().int().positive(),
    status: taskOrchestratorTurnStatusSchema,
    reason: taskOrchestratorTurnReasonSchema,
    primaryAttemptId: taskOrchestratorIdSchema,
    workerAttemptIds: z.array(taskOrchestratorIdSchema).max(100),
    decisionId: taskOrchestratorIdSchema.nullable(),
    checkpointId: taskOrchestratorIdSchema.nullable(),
    capsuleId: taskOrchestratorIdSchema.nullable(),
    context: taskOrchestratorContextUsageSchema.nullable(),
    startedAt: taskOrchestratorTimestampSchema.nullable(),
    updatedAt: taskOrchestratorTimestampSchema,
    finishedAt: taskOrchestratorTimestampSchema.nullable(),
  })
  .strict();

export const taskOrchestratorPauseReasonSchema = z.enum([
  "user",
  "app-quit",
  "supervisor-restart",
  "budget",
  "manual-review",
]);

export const taskOrchestratorPauseSchema = z
  .object({
    reason: taskOrchestratorPauseReasonSchema,
    requestedAt: taskOrchestratorTimestampSchema,
    pausedAt: taskOrchestratorTimestampSchema.nullable(),
    checkpointId: taskOrchestratorIdSchema.nullable(),
    resumeEligible: z.boolean(),
  })
  .strict();

export const taskOrchestratorBudgetSchema = z
  .object({
    primaryTurnsUsed: z.number().int().nonnegative(),
    workerAttemptsUsed: z.number().int().nonnegative(),
    consecutiveFailures: z.number().int().nonnegative(),
    transportRetries: z.number().int().nonnegative().default(0),
    tokensUsed: z.number().int().nonnegative().nullable(),
    costMicrosUsed: z.number().int().nonnegative().nullable(),
    elapsedMs: z.number().int().nonnegative(),
    updatedAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorActorKindSchema = z.enum(["primary", "worker"]);
export const taskOrchestratorAttemptStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "waiting-approval",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

/**
 * A selector is a snapshot of an entry in the Personal live registry.  The
 * desktop service validates the id/model against that registry at mutation
 * time; callers cannot smuggle an arbitrary provider or model id through the
 * normal IPC path.
 */
export const taskOrchestratorAgentSelectionSchema = z
  .object({
    agentId: taskOrchestratorIdSchema,
    provider: taskOrchestratorAgentProviderSchema,
    label: boundedText(120),
    model: z.string().trim().min(1).max(240).nullable(),
    modelLabel: z.string().trim().min(1).max(240).nullable().optional(),
    catalogSource: z.literal("personal-registry"),
    catalogRevision: z.string().trim().min(1).max(240).nullable().optional(),
    capabilitySnapshot: taskOrchestratorProviderCapabilitySnapshotSchema.nullable().default(null),
    timeoutMs: z.number().int().min(1_000).max(14_400_000).optional(),
  })
  .strict();

export const taskOrchestratorAgentProfileSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    label: boundedText(120),
    kind: taskOrchestratorActorKindSchema,
    runtime: z.literal("personal-local-agent"),
    agentId: taskOrchestratorIdSchema,
    provider: taskOrchestratorAgentProviderSchema,
    model: z.string().trim().min(1).max(240).nullable(),
    modelLabel: z.string().trim().min(1).max(240).nullable(),
    catalogSource: z.literal("personal-registry"),
    catalogRevision: z.string().trim().min(1).max(240).nullable(),
    capabilitySnapshot: taskOrchestratorProviderCapabilitySnapshotSchema.nullable().default(null),
    instructions: z.string().trim().max(12_000),
    approvalMode: taskOrchestratorApprovalModeSchema,
    sessionStrategy: z.literal("fresh"),
    timeoutMs: z.number().int().min(1_000).max(14_400_000),
  })
  .strict();

export const taskOrchestratorContractSchema = z
  .object({
    outcome: boundedText(24_000),
    deliverables: z.array(boundedText(4_000)).min(1).max(50),
    acceptance: z.array(boundedText(4_000)).min(1).max(50),
    scope: z
      .object({
        included: z.array(boundedText(4_000)).max(50),
        excluded: z.array(boundedText(4_000)).max(50),
      })
      .strict(),
    verification: z.array(boundedText(4_000)).min(1).max(50),
  })
  .strict();

export const taskOrchestratorAlignmentMessageSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    role: z.enum(["human", "primary"]),
    text: z.string().trim().min(1).max(24_000),
    at: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorContractProposalSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    revision: z.number().int().positive(),
    contract: taskOrchestratorContractSchema,
    source: z.enum(["primary", "human"]),
    createdAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorAlignmentSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(240).nullable(),
    personalRunId: z.string().trim().min(1).max(240).nullable(),
    status: z.enum(["idle", "running", "completed", "failed", "cancelled"]).default("idle"),
    startedAt: taskOrchestratorTimestampSchema.nullable().default(null),
    finishedAt: taskOrchestratorTimestampSchema.nullable().default(null),
    error: z.string().trim().min(1).max(8_000).nullable().default(null),
    messages: z.array(taskOrchestratorAlignmentMessageSchema).max(500),
    proposals: z.array(taskOrchestratorContractProposalSchema).max(100),
    latestProposalId: taskOrchestratorIdSchema.nullable(),
    latestProposalRevision: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.latestProposalId === null) {
      if (value.latestProposalRevision !== null) {
        context.addIssue({ code: "custom", path: ["latestProposalRevision"], message: "A missing proposal cannot have a revision" });
      }
      return;
    }
    const proposal = value.proposals.find((item) => item.id === value.latestProposalId);
    if (!proposal) {
      context.addIssue({ code: "custom", path: ["latestProposalId"], message: "Latest proposal must reference a persisted proposal" });
    } else if (proposal.revision !== value.latestProposalRevision) {
      context.addIssue({ code: "custom", path: ["latestProposalRevision"], message: "Latest proposal revision is stale" });
    }
  });

export const taskOrchestratorDefinitionStatusSchema = z.enum([
  "alignment",
  "awaiting-confirmation",
  "ready",
  "archived",
  "legacy-readonly",
]);

export const taskOrchestratorTaskSchema = z
  .object({
    schemaVersion: z.literal(TASK_ORCHESTRATOR_SCHEMA_VERSION),
    id: taskOrchestratorIdSchema,
    revision: z.number().int().positive(),
    idea: boundedText(24_000),
    workspaceRoot: boundedText(4_096),
    primary: taskOrchestratorAgentProfileSchema,
    allowedWorkers: z.array(taskOrchestratorAgentProfileSchema).max(20),
    independentChecker: taskOrchestratorIndependentCheckerPolicySchema.default({ mode: "primary-only", profile: null, maxRounds: 1 }),
    permissionMode: taskOrchestratorPermissionModeSchema,
    contractFinalization: taskOrchestratorContractFinalizationSchema,
    endConditions: taskOrchestratorEndConditionsSchema,
    contract: taskOrchestratorContractSchema.nullable(),
    definitionStatus: taskOrchestratorDefinitionStatusSchema,
    template: z.literal(TASK_ORCHESTRATOR_TEMPLATE),
    alignment: taskOrchestratorAlignmentSchema,
    latestRunId: taskOrchestratorIdSchema.nullable(),
    createdAt: taskOrchestratorTimestampSchema,
    updatedAt: taskOrchestratorTimestampSchema,
  })
  .strict()
  .superRefine((task, context) => {
    if (task.primary.kind !== "primary") {
      context.addIssue({ code: "custom", path: ["primary", "kind"], message: "Task primary profile must have kind primary" });
    }
    const workerIds = new Set<string>();
    for (const worker of task.allowedWorkers) {
      if (worker.kind !== "worker") {
        context.addIssue({ code: "custom", path: ["allowedWorkers"], message: "Allowed worker profiles must have kind worker" });
      }
      if (workerIds.has(worker.id)) {
        context.addIssue({ code: "custom", path: ["allowedWorkers"], message: `Duplicate worker profile id: ${worker.id}` });
      }
      workerIds.add(worker.id);
    }
    const hasContract = task.contract !== null;
    if (task.definitionStatus === "ready" && !hasContract) {
      context.addIssue({ code: "custom", path: ["contract"], message: "A ready task must have a frozen contract" });
    }
    if (["alignment", "awaiting-confirmation", "legacy-readonly"].includes(task.definitionStatus) && hasContract) {
      context.addIssue({ code: "custom", path: ["contract"], message: "An alignment task must not carry a frozen contract" });
    }
    if (task.definitionStatus === "awaiting-confirmation" && !task.alignment.latestProposalId) {
      context.addIssue({ code: "custom", path: ["alignment", "latestProposalId"], message: "Confirmation requires a contract proposal" });
    }
  });

export const taskOrchestratorRunDefinitionSnapshotSchema = z
  .object({
    idea: boundedText(24_000),
    workspaceRoot: boundedText(4_096),
    primary: taskOrchestratorAgentProfileSchema,
    allowedWorkers: z.array(taskOrchestratorAgentProfileSchema).max(20),
    independentChecker: taskOrchestratorIndependentCheckerPolicySchema.default({ mode: "primary-only", profile: null, maxRounds: 1 }),
    permissionMode: taskOrchestratorPermissionModeSchema,
    contractFinalization: taskOrchestratorContractFinalizationSchema,
    endConditions: taskOrchestratorEndConditionsSchema,
    contract: taskOrchestratorContractSchema,
    template: z.literal(TASK_ORCHESTRATOR_TEMPLATE),
    executionProtocol: taskOrchestratorExecutionProtocolSchema.default("provider-completion-v2"),
  })
  .strict();

export const taskOrchestratorAttemptSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    kind: taskOrchestratorActorKindSchema,
    profileId: taskOrchestratorIdSchema,
    parentAttemptId: taskOrchestratorIdSchema.nullable(),
    turnId: taskOrchestratorIdSchema.nullable().default(null),
    depth: z.number().int().min(0).max(1),
    status: taskOrchestratorAttemptStatusSchema,
    leaseId: taskOrchestratorIdSchema.nullable(),
    personalRunId: z.string().trim().min(1).max(240).nullable(),
    conversationId: z.string().trim().min(1).max(240).nullable(),
    providerDiagnostics: taskOrchestratorProviderDiagnosticsSchema.nullable().default(null),
    providerUsage: taskOrchestratorProviderUsageSchema.nullable().default(null),
    prompt: z.string().max(24_000),
    outputArtifactIds: z.array(taskOrchestratorIdSchema).max(50),
    timeoutMs: z.number().int().min(1_000).max(14_400_000),
    startedAt: taskOrchestratorTimestampSchema.nullable(),
    progressAt: taskOrchestratorTimestampSchema.nullable().default(null),
    notBefore: taskOrchestratorTimestampSchema.nullable().default(null),
    updatedAt: taskOrchestratorTimestampSchema,
    finishedAt: taskOrchestratorTimestampSchema.nullable(),
    error: z.string().max(8_000).nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.kind === "primary" && attempt.depth !== 0) {
      context.addIssue({ code: "custom", path: ["depth"], message: "Primary attempt must run at depth 0" });
    }
    if (attempt.kind === "worker" && attempt.depth !== 1) {
      context.addIssue({ code: "custom", path: ["depth"], message: "Worker attempt must run at depth 1" });
    }
    if (attempt.kind === "primary" && attempt.parentAttemptId !== null) {
      context.addIssue({ code: "custom", path: ["parentAttemptId"], message: "Primary attempt cannot have a parent" });
    }
    if (attempt.kind === "worker" && attempt.parentAttemptId === null) {
      context.addIssue({ code: "custom", path: ["parentAttemptId"], message: "Worker attempt must have a primary parent" });
    }
  });

export const taskOrchestratorRunStatusSchema = z.enum([
  "queued",
  "running",
  "checkpointing",
  "pausing",
  "backoff",
  "waiting-approval",
  "paused",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

export const taskOrchestratorRunSchema = z
  .object({
    schemaVersion: z.literal(TASK_ORCHESTRATOR_SCHEMA_VERSION),
    id: taskOrchestratorIdSchema,
    taskId: taskOrchestratorIdSchema,
    taskRevision: z.number().int().positive(),
    definition: taskOrchestratorRunDefinitionSnapshotSchema,
    status: taskOrchestratorRunStatusSchema,
    primaryAttemptId: taskOrchestratorIdSchema,
    currentAttemptId: taskOrchestratorIdSchema.nullable(),
    primaryAttempts: z.array(taskOrchestratorAttemptSchema).min(1).max(100),
    workerAttempts: z.array(taskOrchestratorAttemptSchema).max(500),
    checkerAttempts: z.array(taskOrchestratorCheckerAttemptSchema).max(3).default([]),
    checkerVerdicts: z.array(taskOrchestratorCheckerVerdictSchema).max(3).default([]),
    primaryDecisions: z.array(taskOrchestratorPrimaryDecisionSchema).max(100).default([]),
    latestDecisionId: taskOrchestratorIdSchema.nullable().default(null),
    sideEffects: z.array(taskOrchestratorSideEffectSchema).max(2_000).default([]),
    turns: z.array(taskOrchestratorTurnSchema).max(100).default([]),
    currentTurnId: taskOrchestratorIdSchema.nullable().default(null),
    checkpoints: z.array(taskOrchestratorCheckpointSchema).max(100).default([]),
    continuationCapsules: z.array(taskOrchestratorContinuationCapsuleSchema).max(100).default([]),
    pause: taskOrchestratorPauseSchema.nullable().default(null),
    budget: taskOrchestratorBudgetSchema.nullable().default(null),
    permissionGrant: taskOrchestratorPermissionGrantSchema.nullable().default(null),
    createdAt: taskOrchestratorTimestampSchema,
    startedAt: taskOrchestratorTimestampSchema.nullable(),
    updatedAt: taskOrchestratorTimestampSchema,
    finishedAt: taskOrchestratorTimestampSchema.nullable(),
    error: z.string().max(8_000).nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    const currentPrimary = run.primaryAttempts.find((attempt) => attempt.id === run.primaryAttemptId);
    if (!currentPrimary || currentPrimary.kind !== "primary") {
      context.addIssue({ code: "custom", path: ["primaryAttemptId"], message: "primaryAttemptId must reference the primary attempt" });
    }
    const ids = new Set(run.primaryAttempts.map((attempt) => attempt.id));
    const primaryIds = new Set(run.primaryAttempts.map((attempt) => attempt.id));
    const decisionIds = new Set<string>();
    const turnIds = new Set<string>();
    const turnSequences = new Set<number>();
    for (const turn of run.turns) {
      if (turnIds.has(turn.id)) context.addIssue({ code: "custom", path: ["turns"], message: `Duplicate turn id: ${turn.id}` });
      if (turnSequences.has(turn.sequence)) context.addIssue({ code: "custom", path: ["turns"], message: `Duplicate turn sequence: ${turn.sequence}` });
      turnIds.add(turn.id);
      turnSequences.add(turn.sequence);
    }
    if (run.currentTurnId !== null && !turnIds.has(run.currentTurnId)) {
      context.addIssue({ code: "custom", path: ["currentTurnId"], message: "currentTurnId must reference a persisted turn" });
    }
    for (const primary of run.primaryAttempts) {
      if (primary.depth !== 0 || primary.parentAttemptId !== null || primary.kind !== "primary") {
        context.addIssue({ code: "custom", path: ["primaryAttempts"], message: "Primary attempts must be depth-zero roots" });
      }
      if (primary.turnId !== null && !turnIds.has(primary.turnId)) {
        context.addIssue({ code: "custom", path: ["primaryAttempts"], message: "Primary attempt turnId must reference this run" });
      }
    }
    for (const worker of run.workerAttempts) {
      if (ids.has(worker.id)) context.addIssue({ code: "custom", path: ["workerAttempts"], message: `Duplicate attempt id: ${worker.id}` });
      ids.add(worker.id);
      if (!run.definition.allowedWorkers.some((profile) => profile.id === worker.profileId)) {
        context.addIssue({ code: "custom", path: ["workerAttempts"], message: `Worker ${worker.profileId} is not allowed by the frozen run definition` });
      }
      if (!worker.parentAttemptId || !primaryIds.has(worker.parentAttemptId)) {
        context.addIssue({ code: "custom", path: ["workerAttempts"], message: "Workers may only be spawned by a primary attempt in this run" });
      }
      if (worker.turnId !== null && !turnIds.has(worker.turnId)) {
        context.addIssue({ code: "custom", path: ["workerAttempts"], message: "Worker attempt turnId must reference this run" });
      }
    }
    const checkerAttemptIds = new Set<string>();
    for (const checker of run.checkerAttempts) {
      if (checkerAttemptIds.has(checker.id) || ids.has(checker.id)) {
        context.addIssue({ code: "custom", path: ["checkerAttempts"], message: `Duplicate checker attempt id: ${checker.id}` });
      }
      checkerAttemptIds.add(checker.id);
      ids.add(checker.id);
      if (checker.profileId !== run.definition.independentChecker.profile?.id) {
        context.addIssue({ code: "custom", path: ["checkerAttempts"], message: "Checker attempts must use the frozen independent checker profile" });
      }
      if (!primaryIds.has(run.primaryAttempts.find((attempt) => attempt.turnId === checker.turnId)?.id ?? "")) {
        context.addIssue({ code: "custom", path: ["checkerAttempts"], message: "Checker attempt turnId must reference a primary turn" });
      }
      const checkerDecision = run.primaryDecisions.find((decision) => decision.id === checker.primaryDecisionId);
      const checkerTurn = run.turns.find((turn) => turn.id === checker.turnId);
      if (!checkerDecision || checkerDecision.turnId !== checker.turnId || checkerTurn?.decisionId !== checker.primaryDecisionId) {
        context.addIssue({ code: "custom", path: ["checkerAttempts"], message: "Checker attempt decision must be linked from the same primary turn" });
      }
    }
    const checkerVerdictIds = new Set<string>();
    for (const verdict of run.checkerVerdicts) {
      if (checkerVerdictIds.has(verdict.id)) {
        context.addIssue({ code: "custom", path: ["checkerVerdicts"], message: `Duplicate checker verdict id: ${verdict.id}` });
      }
      checkerVerdictIds.add(verdict.id);
      if (!checkerAttemptIds.has(verdict.checkerAttemptId)) {
        context.addIssue({ code: "custom", path: ["checkerVerdicts"], message: "Checker verdict must reference a checker attempt" });
      }
      // Primary decisions are validated below (after checker verdicts) so
      // consult the persisted list directly here rather than the set that is
      // populated later in this refinement pass.
      if (!run.primaryDecisions.some((decision) => decision.id === verdict.primaryDecisionId)) {
        context.addIssue({ code: "custom", path: ["checkerVerdicts"], message: "Checker verdict must reference a persisted primary decision" });
      }
    }
    if (run.currentAttemptId !== null && !ids.has(run.currentAttemptId)) {
      context.addIssue({ code: "custom", path: ["currentAttemptId"], message: "Current attempt must exist in the run" });
    }
    for (const decision of run.primaryDecisions) {
      if (!primaryIds.has(decision.attemptId)) {
        context.addIssue({ code: "custom", path: ["primaryDecisions"], message: "Primary decisions must reference a primary attempt in this run" });
      }
      if (decision.turnId !== null && !turnIds.has(decision.turnId)) {
        context.addIssue({ code: "custom", path: ["primaryDecisions"], message: "Primary decision turnId must reference this run" });
      }
      if (decisionIds.has(decision.id)) {
        context.addIssue({ code: "custom", path: ["primaryDecisions"], message: `Duplicate primary decision id: ${decision.id}` });
      }
      decisionIds.add(decision.id);
    }
    if (run.latestDecisionId !== null && !decisionIds.has(run.latestDecisionId)) {
      context.addIssue({ code: "custom", path: ["latestDecisionId"], message: "latestDecisionId must reference a persisted primary decision" });
    }
    const sideEffectIds = new Set<string>();
    for (const sideEffect of run.sideEffects) {
      if (!ids.has(sideEffect.attemptId)) {
        context.addIssue({ code: "custom", path: ["sideEffects"], message: "Side effects must reference an attempt in this run" });
      }
      if (sideEffectIds.has(sideEffect.id)) {
        context.addIssue({ code: "custom", path: ["sideEffects"], message: `Duplicate side-effect id: ${sideEffect.id}` });
      }
      sideEffectIds.add(sideEffect.id);
      if (sideEffect.turnId !== null && !turnIds.has(sideEffect.turnId)) {
        context.addIssue({ code: "custom", path: ["sideEffects"], message: "Side-effect turnId must reference this run" });
      }
    }
    for (const turn of run.turns) {
      if (!primaryIds.has(turn.primaryAttemptId)) {
        context.addIssue({ code: "custom", path: ["turns"], message: "Turn primaryAttemptId must reference a primary attempt" });
      }
      for (const workerAttemptId of turn.workerAttemptIds) {
        if (!ids.has(workerAttemptId)) context.addIssue({ code: "custom", path: ["turns"], message: "Turn workerAttemptIds must reference run attempts" });
      }
      if (turn.decisionId !== null && !decisionIds.has(turn.decisionId)) {
        context.addIssue({ code: "custom", path: ["turns"], message: "Turn decisionId must reference a primary decision" });
      }
    }
    const capsuleIds = new Set(run.continuationCapsules.map((capsule) => capsule.id));
    const checkpointIds = new Set(run.checkpoints.map((checkpoint) => checkpoint.id));
    for (const checkpoint of run.checkpoints) {
      if (!turnIds.has(checkpoint.turnId) || !capsuleIds.has(checkpoint.capsuleId)) {
        context.addIssue({ code: "custom", path: ["checkpoints"], message: "Checkpoint must reference a turn and continuation capsule in this run" });
      }
    }
    if (run.pause?.checkpointId !== null && run.pause && !checkpointIds.has(run.pause.checkpointId)) {
      context.addIssue({ code: "custom", path: ["pause", "checkpointId"], message: "Pause checkpoint must exist in this run" });
    }
    if (run.status === "paused" && (!run.pause || run.pause.pausedAt === null || !run.pause.resumeEligible)) {
      context.addIssue({ code: "custom", path: ["pause"], message: "Paused runs require durable resumable pause metadata" });
    }
  });

export const taskOrchestratorGateKindSchema = z.enum([
  "personal-runtime-approval",
  "high-risk-action",
  "manual-review",
]);
export const taskOrchestratorGateStatusSchema = z.enum([
  "pending",
  "resolving",
  "approved",
  "rejected",
  "cancelled",
]);
export const taskOrchestratorApprovalRiskSchema = z.enum(["safe", "careful", "destructive"]);
export const taskOrchestratorOperationParameterSchema = z.object({ name: boundedText(160), value: z.string().max(4_000) }).strict();
export const taskOrchestratorOperationDetailSchema = z
  .object({
    method: z.string().max(120).nullable(),
    kind: z.string().max(120).nullable(),
    command: z.string().max(8_000).nullable(),
    cwd: z.string().max(4_096).nullable(),
    params: z.array(taskOrchestratorOperationParameterSchema).max(50),
    diff: z.string().max(24_000).nullable(),
    readOnly: z.boolean(),
  })
  .strict();
export const taskOrchestratorHumanGateSchema = z
  .object({
    schemaVersion: z.literal(TASK_ORCHESTRATOR_SCHEMA_VERSION),
    id: taskOrchestratorIdSchema,
    kind: taskOrchestratorGateKindSchema,
    status: taskOrchestratorGateStatusSchema,
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    taskRevision: z.number().int().positive(),
    attemptId: taskOrchestratorIdSchema,
    turnId: taskOrchestratorIdSchema.nullable().default(null),
    // New provider gates bind to the current lease and Personal run. Nullable
    // defaults keep imported/legacy v2 gates parseable and read-only.
    leaseId: taskOrchestratorIdSchema.nullable().default(null),
    personalRunId: z.string().trim().min(1).max(240).nullable().default(null),
    personalApprovalId: z.string().trim().min(1).max(240).nullable(),
    expiresAt: taskOrchestratorTimestampSchema.nullable().default(null),
    title: boundedText(240),
    summary: boundedText(4_000),
    risk: taskOrchestratorApprovalRiskSchema,
    operation: taskOrchestratorOperationDetailSchema,
    requestedAt: taskOrchestratorTimestampSchema,
    decisionRequestedAt: taskOrchestratorTimestampSchema.nullable(),
    resolvedAt: taskOrchestratorTimestampSchema.nullable(),
    decision: z.enum(["approve", "reject"]).nullable(),
  })
  .strict()
  .superRefine((gate, context) => {
    if ((gate.kind === "high-risk-action") !== (gate.risk === "destructive")) {
      context.addIssue({ code: "custom", path: ["risk"], message: "Destructive risk must use a high-risk-action gate" });
    }
    if (gate.status === "pending" && (gate.decision !== null || gate.decisionRequestedAt !== null || gate.resolvedAt !== null)) {
      context.addIssue({ code: "custom", path: ["status"], message: "Pending gates cannot carry a decision" });
    }
    if (gate.status === "resolving" && (gate.decision === null || gate.decisionRequestedAt === null || gate.resolvedAt !== null)) {
      context.addIssue({ code: "custom", path: ["status"], message: "Resolving gates require a durable decision intent" });
    }
    if (gate.status === "approved" && gate.decision !== "approve") context.addIssue({ code: "custom", path: ["decision"], message: "Approved gates require approve" });
    if (gate.status === "rejected" && gate.decision !== "reject") context.addIssue({ code: "custom", path: ["decision"], message: "Rejected gates require reject" });
    if ((gate.status === "approved" || gate.status === "rejected") && (gate.decisionRequestedAt === null || gate.resolvedAt === null)) context.addIssue({ code: "custom", path: ["status"], message: "Resolved gates require timestamps" });
    if (gate.status === "cancelled" && (gate.decision !== null || gate.decisionRequestedAt !== null || gate.resolvedAt === null)) context.addIssue({ code: "custom", path: ["status"], message: "Cancelled gates require only a resolution timestamp" });
    if (gate.decisionRequestedAt !== null && gate.resolvedAt !== null && gate.resolvedAt < gate.decisionRequestedAt) context.addIssue({ code: "custom", path: ["resolvedAt"], message: "Gate cannot resolve before its decision intent" });
  });

export const taskOrchestratorEvidenceSchema = z
  .object({
    kind: z.enum(["command", "file", "test", "review", "message"]),
    provenance: z.enum(["agent-reported", "runtime-observed", "user"]),
    label: boundedText(240),
    value: z.string().max(24_000),
    status: z.enum(["info", "passed", "failed"]),
    exitCode: z.number().int().nullable(),
    path: z.string().trim().min(1).max(4_096).nullable(),
  })
  .strict();
export const taskOrchestratorHandoffArtifactSchema = z
  .object({
    schemaVersion: z.literal(TASK_ORCHESTRATOR_SCHEMA_VERSION),
    id: taskOrchestratorIdSchema,
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    taskRevision: z.number().int().positive(),
    attemptId: taskOrchestratorIdSchema,
    turnId: taskOrchestratorIdSchema.nullable().default(null),
    kind: z.enum(["alignment", "primary", "worker", "evidence"]),
    summary: boundedText(4_000),
    content: z.string().max(500_000),
    evidence: z.array(taskOrchestratorEvidenceSchema).max(100),
    createdAt: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorEventTypeSchema = z.enum([
  "task-archived",
  "task-restored",
  "alignment-started",
  "alignment-message",
  "alignment-completed",
  "alignment-failed",
  "alignment-cancelled",
  "contract-proposed",
  "contract-frozen",
  "run-created",
  "run-started",
  "primary-started",
  "primary-progress",
  "primary-decision-recorded",
  "primary-succeeded",
  "primary-failed",
  "worker-spawned",
  "worker-started",
  "worker-progress",
  "worker-succeeded",
  "worker-failed",
  "worker-closed",
  "checker-started",
  "checker-running",
  "checker-verdict",
  "checker-failed",
  "delegation-rejected",
  "approval-required",
  "approval-resolved",
  "approval-expired",
  "run-succeeded",
  "run-failed",
  "run-blocked",
  "run-cancelled",
  "run-reconciled",
  "primary-recovery-queued",
  "turn-started",
  "turn-checkpointed",
  "turn-continued",
  "run-pausing",
  "run-paused",
  "run-resumed",
  "budget-warning",
  "end-condition-triggered",
]);
export const taskOrchestratorEventSchema = z
  .object({
    schemaVersion: z.literal(TASK_ORCHESTRATOR_SCHEMA_VERSION),
    id: taskOrchestratorIdSchema,
    sequence: z.number().int().positive(),
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema.nullable(),
    attemptId: taskOrchestratorIdSchema.nullable(),
    turnId: taskOrchestratorIdSchema.nullable().default(null),
    type: taskOrchestratorEventTypeSchema,
    message: z.string().max(4_000),
    proposalId: taskOrchestratorIdSchema.nullable().optional(),
    proposalRevision: z.number().int().positive().nullable().optional(),
    at: taskOrchestratorTimestampSchema,
  })
  .strict();

export const taskOrchestratorTaskCreateInputSchema = z
  .object({
    idea: boundedText(24_000),
    workspaceRoot: boundedText(4_096),
    primary: taskOrchestratorAgentSelectionSchema,
    allowedWorkers: z.array(taskOrchestratorAgentSelectionSchema).max(20),
    independentChecker: taskOrchestratorIndependentCheckerPolicySchema.optional(),
    permissionMode: taskOrchestratorPermissionModeSchema.default("restricted"),
    contractFinalization: taskOrchestratorContractFinalizationSchema.default("manual-confirm"),
    endConditions: taskOrchestratorEndConditionsSchema,
  })
  .strict();
export const taskOrchestratorAlignmentMessageInputSchema = z.object({ taskId: taskOrchestratorIdSchema, text: boundedText(24_000) }).strict();
export const taskOrchestratorFinalizeContractInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    expectedRevision: z.number().int().positive(),
    proposalId: taskOrchestratorIdSchema,
    proposalRevision: z.number().int().positive(),
    contract: taskOrchestratorContractSchema.optional(),
  })
  .strict();
export const taskOrchestratorTaskUpdateInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    expectedRevision: z.number().int().positive(),
    idea: boundedText(24_000).optional(),
    primary: taskOrchestratorAgentSelectionSchema.optional(),
    allowedWorkers: z.array(taskOrchestratorAgentSelectionSchema).max(20).optional(),
    independentChecker: taskOrchestratorIndependentCheckerPolicySchema.optional(),
    permissionMode: taskOrchestratorPermissionModeSchema.optional(),
    contractFinalization: taskOrchestratorContractFinalizationSchema.optional(),
    endConditions: taskOrchestratorEndConditionsSchema.optional(),
  })
  .strict();
export const taskOrchestratorTaskIdInputSchema = z.object({ taskId: taskOrchestratorIdSchema }).strict();
export const taskOrchestratorTaskArchiveInputSchema = z
  .object({ taskId: taskOrchestratorIdSchema, expectedRevision: z.number().int().positive() })
  .strict();
export const taskOrchestratorTaskRestoreInputSchema = z
  .object({ taskId: taskOrchestratorIdSchema, expectedRevision: z.number().int().positive() })
  .strict();
export const taskOrchestratorTaskPurgeInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    expectedRevision: z.number().int().positive(),
    confirmation: boundedText(256),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const taskOrchestratorTaskPurgeResultSchema = z
  .object({
    ok: z.literal(true),
    taskId: taskOrchestratorIdSchema,
    taskRevision: z.number().int().positive(),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    auditId: taskOrchestratorIdSchema,
    purgedAt: taskOrchestratorTimestampSchema,
  })
  .strict();
export const taskOrchestratorTaskGetInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema.optional(),
  })
  .strict();
export const taskOrchestratorTaskListInputSchema = z.object({
  workspaceRoot: boundedText(4_096).optional(),
  cursor: z.string().trim().min(1).max(256).nullable().optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict();
export const taskOrchestratorRunIdInputSchema = z.object({ taskRunId: taskOrchestratorIdSchema }).strict();
export const taskOrchestratorRetryInputSchema = z.object({ taskRunId: taskOrchestratorIdSchema, attemptId: taskOrchestratorIdSchema.nullable().optional() }).strict();
/** User-triggered safe continuation of a desktop-interrupted run. */
export const taskOrchestratorRecoveryInputSchema = z.object({ taskRunId: taskOrchestratorIdSchema, attemptId: taskOrchestratorIdSchema.nullable().optional() }).strict();
export const taskOrchestratorResolveGateInputSchema = z.object({ taskRunId: taskOrchestratorIdSchema, gateId: taskOrchestratorIdSchema, decision: z.enum(["approve", "reject"]) }).strict();

export const taskOrchestratorToolCallInputSchema = z
  .object({
    taskRunId: taskOrchestratorIdSchema,
    attemptId: taskOrchestratorIdSchema,
    tool: z.enum([
      "get_task_state",
      "list_agents",
      "spawn_agent",
      "send_message",
      "wait_agent",
      "close_agent",
      "checkpoint_task",
      "continue_task",
      "complete_task",
      "block_task",
      "realign_task",
    ]),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export const taskOrchestratorTaskSummarySchema = z
  .object({
    id: taskOrchestratorIdSchema,
    revision: z.number().int().positive(),
    idea: boundedText(24_000),
    workspaceRoot: boundedText(4_096),
    definitionStatus: taskOrchestratorDefinitionStatusSchema,
    permissionMode: taskOrchestratorPermissionModeSchema,
    contractFinalization: taskOrchestratorContractFinalizationSchema,
    latestRunId: taskOrchestratorIdSchema.nullable(),
    latestRunStatus: taskOrchestratorRunStatusSchema.nullable(),
    currentActor: taskOrchestratorActorKindSchema.nullable(),
    currentTurn: z.number().int().positive().nullable().default(null),
    pauseReason: taskOrchestratorPauseReasonSchema.nullable().default(null),
    resumeEligible: z.boolean().default(false),
    updatedAt: taskOrchestratorTimestampSchema,
  })
  .strict();
export const taskOrchestratorTaskListResultSchema = z.object({
  tasks: z.array(taskOrchestratorTaskSummarySchema).max(200),
  issues: z.array(boundedText(4_000)),
  nextCursor: z.string().max(256).nullable().optional(),
  hasMore: z.boolean().optional(),
}).strict();
export const taskOrchestratorSupervisorResyncEventSchema = z
  .object({
    type: z.literal("task-supervisor-resync"),
    sequence: z.number().int().nonnegative(),
    supervisorEpoch: z.string().trim().min(1).max(240),
    coveredScopes: z.tuple([z.literal("task-list")]),
    snapshot: taskOrchestratorTaskListResultSchema,
  })
  .strict();
export const taskOrchestratorDesktopEventSchema = z.union([
  taskOrchestratorEventSchema,
  taskOrchestratorSupervisorResyncEventSchema,
]);

const taskOrchestratorHistoryPageLimitSchema = z.number().int().min(1).max(200).optional();
const taskOrchestratorHistoryCursorSchema = z.string().trim().min(1).max(256).nullable().optional();

export const taskOrchestratorRunSummarySchema = z
  .object({
    id: taskOrchestratorIdSchema,
    taskId: taskOrchestratorIdSchema,
    taskRevision: z.number().int().positive(),
    status: taskOrchestratorRunStatusSchema,
    currentAttemptId: taskOrchestratorIdSchema.nullable(),
    currentTurn: z.number().int().positive().nullable(),
    primaryAttemptCount: z.number().int().nonnegative(),
    workerAttemptCount: z.number().int().nonnegative(),
    pauseReason: taskOrchestratorPauseReasonSchema.nullable(),
    resumeEligible: z.boolean(),
    createdAt: taskOrchestratorTimestampSchema,
    startedAt: taskOrchestratorTimestampSchema.nullable(),
    updatedAt: taskOrchestratorTimestampSchema,
    finishedAt: taskOrchestratorTimestampSchema.nullable(),
    error: z.string().max(4_000).nullable(),
  })
  .strict();

export const taskOrchestratorRunsListInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    cursor: taskOrchestratorHistoryCursorSchema,
    limit: taskOrchestratorHistoryPageLimitSchema,
  })
  .strict();
export const taskOrchestratorRunsListResultSchema = z
  .object({
    runs: z.array(taskOrchestratorRunSummarySchema).max(200),
    nextCursor: z.string().max(256).nullable(),
    hasMore: z.boolean(),
  })
  .strict();

/**
 * Read-only attempt projections intentionally omit prompts. Prompt text is an
 * execution input, not a history log, and may contain workspace-local context
 * that should not cross the bounded renderer/Supervisor history API.
 */
export const taskOrchestratorTurnHistoryAttemptSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    kind: taskOrchestratorActorKindSchema,
    profileId: taskOrchestratorIdSchema,
    parentAttemptId: taskOrchestratorIdSchema.nullable(),
    turnId: taskOrchestratorIdSchema.nullable(),
    depth: z.number().int().min(0).max(1),
    status: taskOrchestratorAttemptStatusSchema,
    leaseId: taskOrchestratorIdSchema.nullable(),
    personalRunId: z.string().trim().min(1).max(240).nullable(),
    conversationId: z.string().trim().min(1).max(240).nullable(),
    providerDiagnostics: taskOrchestratorProviderDiagnosticsSchema.nullable(),
    providerUsage: taskOrchestratorProviderUsageSchema.nullable(),
    outputArtifactIds: z.array(taskOrchestratorIdSchema).max(50),
    timeoutMs: z.number().int().min(1_000).max(14_400_000),
    startedAt: taskOrchestratorTimestampSchema.nullable(),
    progressAt: taskOrchestratorTimestampSchema.nullable().default(null),
    updatedAt: taskOrchestratorTimestampSchema,
    finishedAt: taskOrchestratorTimestampSchema.nullable(),
    error: z.string().max(8_000).nullable(),
  })
  .strict();
export const taskOrchestratorTurnHistoryCheckerAttemptSchema = z
  .object({
    id: taskOrchestratorIdSchema,
    profileId: taskOrchestratorIdSchema,
    turnId: taskOrchestratorIdSchema,
    primaryDecisionId: taskOrchestratorIdSchema,
    round: z.number().int().min(1).max(3),
    status: taskOrchestratorCheckerAttemptStatusSchema,
    leaseId: taskOrchestratorIdSchema.nullable(),
    personalRunId: z.string().trim().min(1).max(240).nullable(),
    conversationId: z.string().trim().min(1).max(240).nullable(),
    providerDiagnostics: taskOrchestratorProviderDiagnosticsSchema.nullable(),
    providerUsage: taskOrchestratorProviderUsageSchema.nullable(),
    outputArtifactIds: z.array(taskOrchestratorIdSchema).max(50),
    timeoutMs: z.number().int().min(1_000).max(14_400_000),
    startedAt: taskOrchestratorTimestampSchema.nullable(),
    progressAt: taskOrchestratorTimestampSchema.nullable().default(null),
    updatedAt: taskOrchestratorTimestampSchema,
    finishedAt: taskOrchestratorTimestampSchema.nullable(),
    error: z.string().max(8_000).nullable(),
  })
  .strict();

export const taskOrchestratorTurnHistoryCapsuleTruncationSchema = z
  .object({
    truncated: z.boolean(),
    textFieldsTruncated: z.number().int().nonnegative(),
    omitted: z.object({
      completed: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      risks: z.number().int().nonnegative(),
      artifactIds: z.number().int().nonnegative(),
      workspaceEvidence: z.number().int().nonnegative(),
      acceptanceResults: z.number().int().nonnegative(),
      workerMail: z.number().int().nonnegative(),
      unresolvedSideEffects: z.number().int().nonnegative(),
    }).strict(),
  })
  .strict();

/** Full safe capsule structure with explicit bounded-field omission counts. */
export const taskOrchestratorTurnHistoryCapsuleSchema = taskOrchestratorContinuationCapsuleSchema.extend({
  truncation: taskOrchestratorTurnHistoryCapsuleTruncationSchema,
}).strict();

export const taskOrchestratorTurnHistoryItemSchema = z
  .object({
    historyVersion: z.literal(TASK_ORCHESTRATOR_TURN_HISTORY_VERSION),
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    turn: taskOrchestratorTurnSchema,
    primaryAttempt: taskOrchestratorTurnHistoryAttemptSchema,
    workerAttempts: z.array(taskOrchestratorTurnHistoryAttemptSchema).max(100),
    checkerAttempts: z.array(taskOrchestratorTurnHistoryCheckerAttemptSchema).max(3),
    decision: taskOrchestratorPrimaryDecisionSchema.nullable(),
    checkpoint: taskOrchestratorCheckpointSchema.nullable(),
    capsule: taskOrchestratorTurnHistoryCapsuleSchema.nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.primaryAttempt.id !== item.turn.primaryAttemptId || item.primaryAttempt.kind !== "primary") {
      context.addIssue({ code: "custom", path: ["primaryAttempt"], message: "Turn history primary attempt must match the turn" });
    }
    if (item.primaryAttempt.turnId !== item.turn.id) {
      context.addIssue({ code: "custom", path: ["primaryAttempt", "turnId"], message: "Turn history primary attempt must reference the turn" });
    }
    const workers = new Set(item.workerAttempts.map((attempt) => attempt.id));
    if (workers.size !== item.workerAttempts.length
      || item.turn.workerAttemptIds.some((attemptId) => !workers.has(attemptId))
      || item.workerAttempts.some((attempt) => attempt.kind !== "worker" || attempt.turnId !== item.turn.id)) {
      context.addIssue({ code: "custom", path: ["workerAttempts"], message: "Turn history workers must exactly match the turn" });
    }
    if (item.checkerAttempts.some((attempt) => attempt.turnId !== item.turn.id)) {
      context.addIssue({ code: "custom", path: ["checkerAttempts"], message: "Turn history checkers must reference the turn" });
    }
    if ((item.turn.decisionId === null) !== (item.decision === null) || (item.decision && item.decision.id !== item.turn.decisionId)) {
      context.addIssue({ code: "custom", path: ["decision"], message: "Turn history decision must match the turn" });
    }
    if ((item.turn.checkpointId === null) !== (item.checkpoint === null) || (item.checkpoint && (item.checkpoint.id !== item.turn.checkpointId || item.checkpoint.turnId !== item.turn.id))) {
      context.addIssue({ code: "custom", path: ["checkpoint"], message: "Turn history checkpoint must match the turn" });
    }
    if ((item.turn.capsuleId === null) !== (item.capsule === null) || (item.capsule && (item.capsule.id !== item.turn.capsuleId || item.capsule.fromTurnId !== item.turn.id))) {
      context.addIssue({ code: "custom", path: ["capsule"], message: "Turn history capsule must match the turn" });
    }
  });

export const taskOrchestratorTurnHistoryListInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    cursor: taskOrchestratorHistoryCursorSchema,
    limit: taskOrchestratorHistoryPageLimitSchema,
  })
  .strict();

export const taskOrchestratorTurnHistoryListResultSchema = z
  .object({
    historyVersion: z.literal(TASK_ORCHESTRATOR_TURN_HISTORY_VERSION),
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    items: z.array(taskOrchestratorTurnHistoryItemSchema).max(200),
    nextCursor: z.string().max(256).nullable(),
    hasMore: z.boolean(),
    byteBudget: z.literal(TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET),
    serializedBytes: z.number().int().nonnegative().max(TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET),
  })
  .strict();

export const taskOrchestratorEventsListInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema.nullable().optional(),
    cursor: z.number().int().nonnegative().nullable().optional(),
    limit: taskOrchestratorHistoryPageLimitSchema,
  })
  .strict();
export const taskOrchestratorEventsListResultSchema = z
  .object({
    events: z.array(taskOrchestratorEventSchema).max(200),
    nextCursor: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const taskOrchestratorArtifactMetadataSchema = z
  .object({
    schemaVersion: z.literal(TASK_ORCHESTRATOR_SCHEMA_VERSION),
    id: taskOrchestratorIdSchema,
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    taskRevision: z.number().int().positive(),
    attemptId: taskOrchestratorIdSchema,
    turnId: taskOrchestratorIdSchema.nullable(),
    kind: z.enum(["alignment", "primary", "worker", "evidence"]),
    summary: boundedText(4_000),
    evidenceCount: z.number().int().nonnegative().max(100),
    contentBytes: z.number().int().nonnegative(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: taskOrchestratorTimestampSchema,
  })
  .strict();
export const taskOrchestratorArtifactsListInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    cursor: taskOrchestratorHistoryCursorSchema,
    limit: taskOrchestratorHistoryPageLimitSchema,
  })
  .strict();
export const taskOrchestratorArtifactsListResultSchema = z
  .object({
    artifacts: z.array(taskOrchestratorArtifactMetadataSchema).max(200),
    nextCursor: z.string().max(256).nullable(),
    hasMore: z.boolean(),
  })
  .strict();
export const taskOrchestratorArtifactGetInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    artifactId: taskOrchestratorIdSchema,
  })
  .strict();
export const taskOrchestratorArtifactContentGetInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
    artifactId: taskOrchestratorIdSchema,
    offset: z.number().int().nonnegative().optional(),
    limitChars: z.number().int().min(1).max(64_000).optional(),
    evidenceOffset: z.number().int().nonnegative().optional(),
    evidenceLimit: z.number().int().min(1).max(2).optional(),
  })
  .strict();
export const taskOrchestratorArtifactContentResultSchema = z
  .object({
    artifact: taskOrchestratorArtifactMetadataSchema,
    offset: z.number().int().nonnegative(),
    contentChunk: z.string().max(64_000),
    nextOffset: z.number().int().nonnegative().nullable(),
    complete: z.boolean(),
    totalChars: z.number().int().nonnegative(),
    evidenceOffset: z.number().int().nonnegative(),
    evidence: z.array(taskOrchestratorEvidenceSchema).max(2),
    nextEvidenceOffset: z.number().int().nonnegative().nullable(),
    evidenceComplete: z.boolean(),
    totalEvidence: z.number().int().nonnegative().max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const consumedOffset = value.offset + value.contentChunk.length;
    if (consumedOffset > value.totalChars) {
      context.addIssue({ code: "custom", path: ["contentChunk"], message: "Artifact chunk exceeds total content length" });
    }
    if (value.complete !== (value.nextOffset === null)) {
      context.addIssue({ code: "custom", path: ["nextOffset"], message: "A complete artifact chunk must not expose a next offset" });
    }
    if (value.complete && consumedOffset !== value.totalChars) {
      context.addIssue({ code: "custom", path: ["complete"], message: "A complete artifact chunk must reach the total content length" });
    }
    if (value.nextOffset !== null && value.nextOffset !== consumedOffset) {
      context.addIssue({ code: "custom", path: ["nextOffset"], message: "Artifact chunk next offset must follow the returned content" });
    }
    const consumedEvidenceOffset = value.evidenceOffset + value.evidence.length;
    if (consumedEvidenceOffset > value.totalEvidence) {
      context.addIssue({ code: "custom", path: ["evidence"], message: "Artifact evidence page exceeds the total evidence count" });
    }
    if (value.evidenceComplete !== (value.nextEvidenceOffset === null)) {
      context.addIssue({ code: "custom", path: ["nextEvidenceOffset"], message: "A complete evidence page must not expose a next offset" });
    }
    if (value.evidenceComplete && consumedEvidenceOffset !== value.totalEvidence) {
      context.addIssue({ code: "custom", path: ["evidenceComplete"], message: "A complete evidence page must reach the total evidence count" });
    }
    if (value.nextEvidenceOffset !== null && value.nextEvidenceOffset !== consumedEvidenceOffset) {
      context.addIssue({ code: "custom", path: ["nextEvidenceOffset"], message: "Artifact evidence next offset must follow the returned evidence" });
    }
  });

const taskOrchestratorSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const taskOrchestratorTaskExportManifestInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    cursor: z.number().int().nonnegative().nullable().optional(),
    limit: taskOrchestratorHistoryPageLimitSchema,
  })
  .strict();
export const taskOrchestratorTaskExportEntrySchema = z
  .object({
    index: z.number().int().nonnegative(),
    kind: z.enum(["task", "run", "event", "artifact", "gate"]),
    id: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema.nullable(),
    sequence: z.number().int().positive().nullable(),
    recordBytes: z.number().int().nonnegative(),
    recordSha256: taskOrchestratorSha256Schema,
    contentBytes: z.number().int().nonnegative().nullable(),
    contentSha256: taskOrchestratorSha256Schema.nullable(),
  })
  .strict();
export const taskOrchestratorTaskExportCountsSchema = z
  .object({
    tasks: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    gates: z.number().int().nonnegative(),
  })
  .strict();
export const taskOrchestratorTaskExportManifestResultSchema = z
  .object({
    manifestVersion: z.literal(TASK_ORCHESTRATOR_EXPORT_MANIFEST_VERSION),
    taskId: taskOrchestratorIdSchema,
    taskRevision: z.number().int().positive(),
    manifestSha256: taskOrchestratorSha256Schema,
    totalEntries: z.number().int().positive(),
    counts: taskOrchestratorTaskExportCountsSchema,
    entries: z.array(taskOrchestratorTaskExportEntrySchema).max(200),
    nextCursor: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const taskOrchestratorMaintenanceInputSchema = z
  .object({
    retentionMs: z.number().int().min(0).max(365 * 24 * 60 * 60 * 1_000).optional(),
    maxTerminalRowsPerTable: z.number().int().min(1).max(20_000).optional(),
    incrementalVacuumPages: z.number().int().min(1).max(4_096).optional(),
  })
  .strict();
export const taskOrchestratorStoreHealthInputSchema = z.object({}).strict();
export const taskOrchestratorMaintenancePolicySchema = z
  .object({
    retentionMs: z.number().int().min(0),
    maxTerminalRowsPerTable: z.number().int().positive(),
    incrementalVacuumPages: z.number().int().positive(),
  })
  .strict();
export const taskOrchestratorStoreRowCountsSchema = z
  .object({
    tasks: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    gates: z.number().int().nonnegative(),
    rpcRequests: z.number().int().nonnegative(),
    outbox: z.number().int().nonnegative(),
    processes: z.number().int().nonnegative(),
    rpcRequestTerminal: z.number().int().nonnegative(),
    outboxTerminal: z.number().int().nonnegative(),
    processTombstones: z.number().int().nonnegative(),
  })
  .strict();
export const taskOrchestratorStorageMetricsSchema = z
  .object({
    pageSize: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    freelistCount: z.number().int().nonnegative(),
    databaseBytes: z.number().int().nonnegative(),
    databaseFileBytes: z.number().int().nonnegative(),
    walBytes: z.number().int().nonnegative(),
    shmBytes: z.number().int().nonnegative(),
    totalFileBytes: z.number().int().nonnegative(),
    reclaimableBytes: z.number().int().nonnegative(),
    autoVacuum: z.enum(["incremental", "disabled"]),
    budgetBytes: z.number().int().positive(),
    warningBytes: z.number().int().positive(),
    exhausted: z.boolean(),
    warnings: z.array(z.string().trim().min(1).max(240)).max(8),
  })
  .strict();
export const taskOrchestratorMaintenanceResultSchema = z
  .object({
    ranAt: taskOrchestratorTimestampSchema,
    policy: taskOrchestratorMaintenancePolicySchema,
    cutoff: taskOrchestratorTimestampSchema,
    before: taskOrchestratorStoreRowCountsSchema,
    after: taskOrchestratorStoreRowCountsSchema,
    deleted: z.object({
      rpcRequests: z.number().int().nonnegative(),
      outbox: z.number().int().nonnegative(),
      processTombstones: z.number().int().nonnegative(),
    }).strict(),
    protectedRows: z.object({
      tasks: z.number().int().nonnegative(),
      runs: z.number().int().nonnegative(),
      artifacts: z.number().int().nonnegative(),
    }).strict(),
    storage: z.object({
      before: taskOrchestratorStorageMetricsSchema,
      after: taskOrchestratorStorageMetricsSchema,
      checkpoint: z.object({
        busy: z.number().int().nonnegative(),
        logFrames: z.number().int().nonnegative(),
        checkpointedFrames: z.number().int().nonnegative(),
      }).strict(),
      incrementalVacuumPages: z.number().int().positive(),
    }).strict(),
  })
  .strict();
export const taskOrchestratorStoreHealthResultSchema = z
  .object({
    dbPath: z.string().trim().min(1).max(4_096),
    corruptionMarkerPath: z.string().trim().min(1).max(4_096),
    pragmas: z.object({
      journalMode: z.string().max(40),
      synchronous: z.number().int(),
      walAutoCheckpointPages: z.number().int().positive(),
      foreignKeys: z.boolean(),
      busyTimeoutMs: z.number().int().nonnegative(),
      trustedSchema: z.boolean(),
      autoVacuum: z.enum(["incremental", "disabled"]),
    }).strict(),
    quickCheck: z.array(z.string().max(4_000)).max(100),
    healthy: z.boolean(),
    rows: taskOrchestratorStoreRowCountsSchema,
    storage: taskOrchestratorStorageMetricsSchema,
    maintenancePolicy: taskOrchestratorMaintenancePolicySchema,
    lastMaintenance: taskOrchestratorMaintenanceResultSchema.nullable(),
  })
  .strict();

/**
 * Cheap aggregate used by active operations polling.  It deliberately has
 * no quick_check payload and keeps process rows to grouped states plus a
 * bounded PID list.
 */
export const taskOrchestratorDiagnosticsProcessAggregateSchema = z
  .object({
    count: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    states: z.record(z.string().trim().min(1).max(40), z.number().int().nonnegative()),
    pids: z.array(z.number().int().positive()).max(64),
  })
  .strict();

export const taskOrchestratorDiagnosticsHealthResultSchema = z
  .object({
    observed: z.boolean(),
    observedAt: taskOrchestratorTimestampSchema.nullable(),
    stale: z.boolean(),
    healthy: z.boolean().nullable(),
    rows: taskOrchestratorStoreRowCountsSchema,
    storage: taskOrchestratorStorageMetricsSchema,
    processes: taskOrchestratorDiagnosticsProcessAggregateSchema,
    lastMaintenance: taskOrchestratorMaintenanceResultSchema.nullable(),
  })
  .strict();

/**
 * Read-only, secret-free operational diagnostics. This surface is deliberately
 * separate from the high-frequency task snapshot so that bounded storage and
 * lease/process evidence can be inspected without exposing prompts or raw
 * provider output.
 */
export const taskOrchestratorOperationsDiagnosticsGetInputSchema = z
  .object({
    taskId: taskOrchestratorIdSchema,
    taskRunId: taskOrchestratorIdSchema,
  })
  .strict();

const taskOrchestratorOperationsTerminalReasonSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    category: z.string().trim().min(1).max(64),
    message: z.string().trim().min(1).max(280),
  })
  .strict();

const taskOrchestratorOperationsAttemptSchema = z
  .object({
    attemptId: taskOrchestratorIdSchema.nullable(),
    status: z.string().trim().min(1).max(40),
    leaseId: taskOrchestratorIdSchema.nullable(),
    leaseAgeMs: z.number().int().nonnegative().nullable(),
    leaseExpiresAt: taskOrchestratorTimestampSchema.nullable(),
    progressAt: taskOrchestratorTimestampSchema.nullable(),
    progressAgeMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

const taskOrchestratorOperationsContextSchema = z
  .object({
    usedTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    percent: z.number().nonnegative().max(100).nullable(),
    source: z.string().trim().min(1).max(40),
    modelId: z.string().trim().min(1).max(240).nullable(),
    observedAt: taskOrchestratorTimestampSchema.nullable(),
    observed: z.boolean(),
  })
  .strict();

const taskOrchestratorOperationsRetriesSchema = z
  .object({
    transportRetries: z.number().int().nonnegative(),
    consecutiveFailures: z.number().int().nonnegative(),
    primaryTurnsUsed: z.number().int().nonnegative(),
    workerAttemptsUsed: z.number().int().nonnegative(),
  })
  .strict();

const taskOrchestratorOperationsProviderSchema = z
  .object({
    session: z.string().trim().min(1).max(240).nullable(),
    effectiveModel: z.string().trim().min(1).max(240).nullable(),
    transport: z.string().trim().min(1).max(120).nullable(),
    /** Human/provider connection label is distinct from the wire transport. */
    connectionMode: z.string().trim().min(1).max(240).nullable().optional(),
    requestId: z.string().trim().min(1).max(240).nullable(),
    fallbackCount: z.number().int().nonnegative(),
    observed: z.boolean(),
  })
  .strict();

const taskOrchestratorOperationsProcessesSchema = z
  .object({
    count: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    states: z.record(z.string().trim().min(1).max(40), z.number().int().nonnegative()),
    pids: z.array(z.number().int().positive()).max(64),
  })
  .strict();

const taskOrchestratorOperationsStorageSchema = z
  .object({
    /** Availability/integrity is unknown until a diagnostic observation exists. */
    observed: z.boolean().optional(),
    observedAt: taskOrchestratorTimestampSchema.nullable().optional(),
    stale: z.boolean().optional(),
    healthy: z.boolean().nullable(),
    databaseBytes: z.number().int().nonnegative().nullable(),
    reclaimableBytes: z.number().int().nonnegative().nullable(),
    outboxCount: z.number().int().nonnegative().nullable(),
    processCount: z.number().int().nonnegative().nullable(),
    lastMaintenanceAt: taskOrchestratorTimestampSchema.nullable(),
  })
  .strict();

export const taskOrchestratorOperationsDiagnosticsFullSchema = z
  .object({
    version: z.literal(1),
    generatedAt: taskOrchestratorTimestampSchema,
    terminalReason: taskOrchestratorOperationsTerminalReasonSchema,
    attempt: taskOrchestratorOperationsAttemptSchema,
    context: taskOrchestratorOperationsContextSchema,
    retries: taskOrchestratorOperationsRetriesSchema,
    provider: taskOrchestratorOperationsProviderSchema,
    processes: taskOrchestratorOperationsProcessesSchema,
    storage: taskOrchestratorOperationsStorageSchema,
    truncated: z.literal(false),
  })
  .strict();

/** Minimal byte-capped fallback emitted when a full diagnostic cannot fit. */
export const taskOrchestratorOperationsDiagnosticsMinimalSchema = z
  .object({
    version: z.literal(1),
    generatedAt: taskOrchestratorTimestampSchema,
    terminalReason: taskOrchestratorOperationsTerminalReasonSchema.optional(),
    attempt: taskOrchestratorOperationsAttemptSchema.partial().optional(),
    context: taskOrchestratorOperationsContextSchema.partial().optional(),
    retries: taskOrchestratorOperationsRetriesSchema.partial().optional(),
    provider: taskOrchestratorOperationsProviderSchema.partial().optional(),
    processes: taskOrchestratorOperationsProcessesSchema.partial().optional(),
    storage: taskOrchestratorOperationsStorageSchema.partial().optional(),
    truncated: z.literal(true),
  })
  .strict();

export const taskOrchestratorOperationsDiagnosticsSchema = z.union([
  taskOrchestratorOperationsDiagnosticsFullSchema,
  taskOrchestratorOperationsDiagnosticsMinimalSchema,
]);

export const taskOrchestratorSnapshotOmittedSchema = z
  .object({
    events: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    gates: z.number().int().nonnegative(),
    alignmentMessages: z.number().int().nonnegative(),
    contractProposals: z.number().int().nonnegative(),
    primaryAttempts: z.number().int().nonnegative(),
    workerAttempts: z.number().int().nonnegative(),
    primaryDecisions: z.number().int().nonnegative(),
    sideEffects: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    checkpoints: z.number().int().nonnegative(),
    continuationCapsules: z.number().int().nonnegative(),
    artifactContentBytes: z.number().int().nonnegative(),
    artifactEvidence: z.number().int().nonnegative(),
  })
  .strict();

const EMPTY_SNAPSHOT_OMITTED = Object.freeze({
  events: 0,
  artifacts: 0,
  gates: 0,
  alignmentMessages: 0,
  contractProposals: 0,
  primaryAttempts: 0,
  workerAttempts: 0,
  primaryDecisions: 0,
  sideEffects: 0,
  turns: 0,
  checkpoints: 0,
  continuationCapsules: 0,
  artifactContentBytes: 0,
  artifactEvidence: 0,
});

export const taskOrchestratorSnapshotTruncationSchema = z
  .object({
    truncated: z.boolean(),
    byteBudget: z.number().int().positive(),
    serializedBytes: z.number().int().nonnegative(),
    omitted: taskOrchestratorSnapshotOmittedSchema,
    compactedTask: z.boolean(),
    compactedRun: z.boolean(),
    eventMessagesTruncated: z.number().int().nonnegative(),
    gateDetailsTruncated: z.number().int().nonnegative(),
    artifactContentTruncatedIds: z.array(taskOrchestratorIdSchema).max(200),
  })
  .strict();
export const taskOrchestratorSnapshotSchema = z
  .object({
    task: taskOrchestratorTaskSchema,
    run: taskOrchestratorRunSchema.nullable(),
    artifacts: z.array(taskOrchestratorHandoffArtifactSchema),
    events: z.array(taskOrchestratorEventSchema),
    gates: z.array(taskOrchestratorHumanGateSchema),
    truncation: taskOrchestratorSnapshotTruncationSchema.default({
      truncated: false,
      byteBudget: TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET,
      serializedBytes: 0,
      omitted: EMPTY_SNAPSHOT_OMITTED,
      compactedTask: false,
      compactedRun: false,
      eventMessagesTruncated: 0,
      gateDetailsTruncated: 0,
      artifactContentTruncatedIds: [],
    }),
  })
  .strict();

/** A permissive detector used by the store to issue an explicit v1 error. */
export const taskOrchestratorLegacyTaskSchema = z.object({ schemaVersion: z.literal(TASK_ORCHESTRATOR_LEGACY_SCHEMA_VERSION) }).passthrough();

export type TaskOrchestratorPermissionMode = z.infer<typeof taskOrchestratorPermissionModeSchema>;
export type TaskOrchestratorPermissionGrant = z.infer<typeof taskOrchestratorPermissionGrantSchema>;
export type TaskOrchestratorContractFinalization = z.infer<typeof taskOrchestratorContractFinalizationSchema>;
export type TaskOrchestratorExecutionProtocol = z.infer<typeof taskOrchestratorExecutionProtocolSchema>;
export type TaskOrchestratorPrimaryDecisionKind = z.infer<typeof taskOrchestratorPrimaryDecisionKindSchema>;
export type TaskOrchestratorCriterionResult = z.infer<typeof taskOrchestratorCriterionResultSchema>;
export type TaskOrchestratorPrimaryDecision = z.infer<typeof taskOrchestratorPrimaryDecisionSchema>;
export type TaskOrchestratorPrimaryDecisionInput = z.infer<typeof taskOrchestratorPrimaryDecisionInputSchema>;
export type TaskOrchestratorIndependentCheckerMode = z.infer<typeof taskOrchestratorIndependentCheckerModeSchema>;
export type TaskOrchestratorCheckerProfile = z.infer<typeof taskOrchestratorCheckerProfileSchema>;
export type TaskOrchestratorIndependentCheckerPolicy = z.infer<typeof taskOrchestratorIndependentCheckerPolicySchema>;
export type TaskOrchestratorCheckerAttemptStatus = z.infer<typeof taskOrchestratorCheckerAttemptStatusSchema>;
export type TaskOrchestratorCheckerAttempt = z.infer<typeof taskOrchestratorCheckerAttemptSchema>;
export type TaskOrchestratorCheckerCriterionResult = z.infer<typeof taskOrchestratorCheckerCriterionResultSchema>;
export type TaskOrchestratorCheckerVerdict = z.infer<typeof taskOrchestratorCheckerVerdictSchema>;
export type TaskOrchestratorSideEffectIdempotency = z.infer<typeof taskOrchestratorSideEffectIdempotencySchema>;
export type TaskOrchestratorSideEffectReceiptStatus = z.infer<typeof taskOrchestratorSideEffectReceiptStatusSchema>;
export type TaskOrchestratorSideEffectIntentSource = z.infer<typeof taskOrchestratorSideEffectIntentSourceSchema>;
export type TaskOrchestratorSideEffect = z.infer<typeof taskOrchestratorSideEffectSchema>;
export type TaskOrchestratorCompletionAuthority = z.infer<typeof taskOrchestratorCompletionAuthoritySchema>;
export type TaskOrchestratorEndConditions = z.infer<typeof taskOrchestratorEndConditionsSchema>;
export type TaskOrchestratorContextUsageSource = z.infer<typeof taskOrchestratorContextUsageSourceSchema>;
export type TaskOrchestratorContextUsage = z.infer<typeof taskOrchestratorContextUsageSchema>;
export type TaskOrchestratorTurnStatus = z.infer<typeof taskOrchestratorTurnStatusSchema>;
export type TaskOrchestratorTurnReason = z.infer<typeof taskOrchestratorTurnReasonSchema>;
export type TaskOrchestratorContinuationCapsule = z.infer<typeof taskOrchestratorContinuationCapsuleSchema>;
export type TaskOrchestratorCheckpointTrigger = z.infer<typeof taskOrchestratorCheckpointTriggerSchema>;
export type TaskOrchestratorCheckpoint = z.infer<typeof taskOrchestratorCheckpointSchema>;
export type TaskOrchestratorTurn = z.infer<typeof taskOrchestratorTurnSchema>;
export type TaskOrchestratorPauseReason = z.infer<typeof taskOrchestratorPauseReasonSchema>;
export type TaskOrchestratorPause = z.infer<typeof taskOrchestratorPauseSchema>;
export type TaskOrchestratorBudget = z.infer<typeof taskOrchestratorBudgetSchema>;
export type TaskOrchestratorActorKind = z.infer<typeof taskOrchestratorActorKindSchema>;
export type TaskOrchestratorAgentProvider = z.infer<typeof taskOrchestratorAgentProviderSchema>;
export type TaskOrchestratorAgentSelection = z.infer<typeof taskOrchestratorAgentSelectionSchema>;
export type TaskOrchestratorAgentProfile = z.infer<typeof taskOrchestratorAgentProfileSchema>;
export type TaskOrchestratorProviderCapabilitySnapshot = z.infer<typeof taskOrchestratorProviderCapabilitySnapshotSchema>;
export type TaskOrchestratorProviderDiagnostics = z.infer<typeof taskOrchestratorProviderDiagnosticsSchema>;
export type TaskOrchestratorProviderUsage = z.infer<typeof taskOrchestratorProviderUsageSchema>;
export type TaskOrchestratorContract = z.infer<typeof taskOrchestratorContractSchema>;
export type TaskOrchestratorAlignment = z.infer<typeof taskOrchestratorAlignmentSchema>;
export type TaskOrchestratorContractProposal = z.infer<typeof taskOrchestratorContractProposalSchema>;
export type TaskOrchestratorTask = z.infer<typeof taskOrchestratorTaskSchema>;
export type TaskOrchestratorAttempt = z.infer<typeof taskOrchestratorAttemptSchema>;
export type TaskOrchestratorRun = z.infer<typeof taskOrchestratorRunSchema>;
export type TaskOrchestratorHumanGate = z.infer<typeof taskOrchestratorHumanGateSchema>;
export type TaskOrchestratorApprovalRisk = z.infer<typeof taskOrchestratorApprovalRiskSchema>;
export type TaskOrchestratorOperationParameter = z.infer<typeof taskOrchestratorOperationParameterSchema>;
export type TaskOrchestratorOperationDetail = z.infer<typeof taskOrchestratorOperationDetailSchema>;
export type TaskOrchestratorHandoffArtifact = z.infer<typeof taskOrchestratorHandoffArtifactSchema>;
export type TaskOrchestratorEvidence = z.infer<typeof taskOrchestratorEvidenceSchema>;
export type TaskOrchestratorEvent = z.infer<typeof taskOrchestratorEventSchema>;
export type TaskOrchestratorTaskCreateInput = z.infer<typeof taskOrchestratorTaskCreateInputSchema>;
export type TaskOrchestratorAlignmentMessageInput = z.infer<typeof taskOrchestratorAlignmentMessageInputSchema>;
export type TaskOrchestratorFinalizeContractInput = z.infer<typeof taskOrchestratorFinalizeContractInputSchema>;
export type TaskOrchestratorTaskUpdateInput = z.infer<typeof taskOrchestratorTaskUpdateInputSchema>;
export type TaskOrchestratorTaskIdInput = z.infer<typeof taskOrchestratorTaskIdInputSchema>;
export type TaskOrchestratorTaskArchiveInput = z.infer<typeof taskOrchestratorTaskArchiveInputSchema>;
export type TaskOrchestratorTaskRestoreInput = z.infer<typeof taskOrchestratorTaskRestoreInputSchema>;
export type TaskOrchestratorTaskPurgeInput = z.infer<typeof taskOrchestratorTaskPurgeInputSchema>;
export type TaskOrchestratorTaskPurgeResult = z.infer<typeof taskOrchestratorTaskPurgeResultSchema>;
export type TaskOrchestratorTaskGetInput = z.infer<typeof taskOrchestratorTaskGetInputSchema>;
export type TaskOrchestratorTaskListInput = z.infer<typeof taskOrchestratorTaskListInputSchema>;
export type TaskOrchestratorRunIdInput = z.infer<typeof taskOrchestratorRunIdInputSchema>;
export type TaskOrchestratorRetryInput = z.infer<typeof taskOrchestratorRetryInputSchema>;
export type TaskOrchestratorRecoveryInput = z.infer<typeof taskOrchestratorRecoveryInputSchema>;
export type TaskOrchestratorResolveGateInput = z.infer<typeof taskOrchestratorResolveGateInputSchema>;
export type TaskOrchestratorToolCallInput = z.infer<typeof taskOrchestratorToolCallInputSchema>;
export type TaskOrchestratorTaskSummary = z.infer<typeof taskOrchestratorTaskSummarySchema>;
export type TaskOrchestratorTaskListResult = z.infer<typeof taskOrchestratorTaskListResultSchema>;
export type TaskOrchestratorSupervisorResyncEvent = z.infer<typeof taskOrchestratorSupervisorResyncEventSchema>;
export type TaskOrchestratorDesktopEvent = z.infer<typeof taskOrchestratorDesktopEventSchema>;
export type TaskOrchestratorRunSummary = z.infer<typeof taskOrchestratorRunSummarySchema>;
export type TaskOrchestratorRunsListInput = z.infer<typeof taskOrchestratorRunsListInputSchema>;
export type TaskOrchestratorRunsListResult = z.infer<typeof taskOrchestratorRunsListResultSchema>;
export type TaskOrchestratorTurnHistoryAttempt = z.infer<typeof taskOrchestratorTurnHistoryAttemptSchema>;
export type TaskOrchestratorTurnHistoryCheckerAttempt = z.infer<typeof taskOrchestratorTurnHistoryCheckerAttemptSchema>;
export type TaskOrchestratorTurnHistoryCapsuleTruncation = z.infer<typeof taskOrchestratorTurnHistoryCapsuleTruncationSchema>;
export type TaskOrchestratorTurnHistoryCapsule = z.infer<typeof taskOrchestratorTurnHistoryCapsuleSchema>;
export type TaskOrchestratorTurnHistoryItem = z.infer<typeof taskOrchestratorTurnHistoryItemSchema>;
export type TaskOrchestratorTurnHistoryListInput = z.infer<typeof taskOrchestratorTurnHistoryListInputSchema>;
export type TaskOrchestratorTurnHistoryListResult = z.infer<typeof taskOrchestratorTurnHistoryListResultSchema>;
export type TaskOrchestratorEventsListInput = z.infer<typeof taskOrchestratorEventsListInputSchema>;
export type TaskOrchestratorEventsListResult = z.infer<typeof taskOrchestratorEventsListResultSchema>;
export type TaskOrchestratorArtifactMetadata = z.infer<typeof taskOrchestratorArtifactMetadataSchema>;
export type TaskOrchestratorArtifactsListInput = z.infer<typeof taskOrchestratorArtifactsListInputSchema>;
export type TaskOrchestratorArtifactsListResult = z.infer<typeof taskOrchestratorArtifactsListResultSchema>;
export type TaskOrchestratorArtifactGetInput = z.infer<typeof taskOrchestratorArtifactGetInputSchema>;
export type TaskOrchestratorArtifactContentGetInput = z.infer<typeof taskOrchestratorArtifactContentGetInputSchema>;
export type TaskOrchestratorArtifactContentResult = z.infer<typeof taskOrchestratorArtifactContentResultSchema>;
export type TaskOrchestratorTaskExportManifestInput = z.infer<typeof taskOrchestratorTaskExportManifestInputSchema>;
export type TaskOrchestratorTaskExportEntry = z.infer<typeof taskOrchestratorTaskExportEntrySchema>;
export type TaskOrchestratorTaskExportCounts = z.infer<typeof taskOrchestratorTaskExportCountsSchema>;
export type TaskOrchestratorTaskExportManifestResult = z.infer<typeof taskOrchestratorTaskExportManifestResultSchema>;
export type TaskOrchestratorMaintenanceInput = z.infer<typeof taskOrchestratorMaintenanceInputSchema>;
export type TaskOrchestratorMaintenancePolicy = z.infer<typeof taskOrchestratorMaintenancePolicySchema>;
export type TaskOrchestratorStoreRowCounts = z.infer<typeof taskOrchestratorStoreRowCountsSchema>;
export type TaskOrchestratorStorageMetrics = z.infer<typeof taskOrchestratorStorageMetricsSchema>;
export type TaskOrchestratorMaintenanceResult = z.infer<typeof taskOrchestratorMaintenanceResultSchema>;
export type TaskOrchestratorStoreHealthResult = z.infer<typeof taskOrchestratorStoreHealthResultSchema>;
export type TaskOrchestratorDiagnosticsProcessAggregate = z.infer<typeof taskOrchestratorDiagnosticsProcessAggregateSchema>;
export type TaskOrchestratorDiagnosticsHealthResult = z.infer<typeof taskOrchestratorDiagnosticsHealthResultSchema>;
export type TaskOrchestratorStoreHealthInput = z.infer<typeof taskOrchestratorStoreHealthInputSchema>;
export type TaskOrchestratorOperationsDiagnosticsGetInput = z.infer<typeof taskOrchestratorOperationsDiagnosticsGetInputSchema>;
export type TaskOrchestratorOperationsDiagnostics = z.infer<typeof taskOrchestratorOperationsDiagnosticsSchema>;
export type TaskOrchestratorSnapshotOmitted = z.infer<typeof taskOrchestratorSnapshotOmittedSchema>;
export type TaskOrchestratorSnapshotTruncation = z.infer<typeof taskOrchestratorSnapshotTruncationSchema>;
export type TaskOrchestratorSnapshot = z.infer<typeof taskOrchestratorSnapshotSchema>;
