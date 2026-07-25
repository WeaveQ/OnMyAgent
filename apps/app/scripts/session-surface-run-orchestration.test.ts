import { describe, expect, test } from "bun:test";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerCollaborationMode,
  ComposerDraft,
} from "../src/app/types";
import {
  applySendDraftIntents,
  buildAbortPlanRuntime,
  buildGoalPauseRuntime,
  buildGoalResumeRuntime,
  buildPlanExecutionRequest,
  goalResumeCollaborationMode,
  makeSessionRunKey,
  resolveAbortAction,
  shouldBlockCodeDraftSend,
} from "../src/react-app/domains/session/surface/session-surface-run-orchestration";

function baseDraft(text: string): ComposerDraft {
  return {
    mode: "prompt",
    parts: [{ type: "text", text }],
    attachments: [],
    text,
    resolvedText: text,
  };
}

function goalRuntime(
  overrides: Partial<CollaborationGoalRuntime> = {},
): CollaborationGoalRuntime {
  return {
    source: "goal_intent",
    objective: "ship cold start",
    summary: "ship cold start",
    status: "paused",
    messageBaseline: 0,
    totalPausedMs: 0,
    startedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function planRuntime(
  overrides: Partial<CollaborationPlanRuntime> = {},
): CollaborationPlanRuntime {
  return {
    originalPrompt: "plan the work",
    planText: "1. do\n2. check",
    messageBaseline: 0,
    status: "awaiting_approval",
    createdAt: 1,
    ...overrides,
  };
}

describe("session-surface run orchestration (shipped)", () => {
  test("makeSessionRunKey is stable", () => {
    expect(makeSessionRunKey("ses_1", 42)).toBe("ses_1:42");
  });

  test("shouldBlockCodeDraftSend only for code draft home without folder", () => {
    expect(
      shouldBlockCodeDraftSend({
        assistantCodeFeaturesActive: true,
        draftOnly: true,
        assistantFeatureCategoryId: "code",
        draftWorkspaceDirectory: "",
      }),
    ).toBe(true);
    expect(
      shouldBlockCodeDraftSend({
        assistantCodeFeaturesActive: true,
        draftOnly: true,
        assistantFeatureCategoryId: "code",
        draftWorkspaceDirectory: "/tmp/ws",
      }),
    ).toBe(false);
    expect(
      shouldBlockCodeDraftSend({
        assistantCodeFeaturesActive: true,
        draftOnly: false,
        assistantFeatureCategoryId: "code",
        draftWorkspaceDirectory: "",
      }),
    ).toBe(false);
  });

  test("applySendDraftIntents attaches planningIntent in plan mode", () => {
    const mode: ComposerCollaborationMode = {
      kind: "plan",
      planning: true,
      pursueGoal: false,
    };
    const result = applySendDraftIntents({
      draft: baseDraft("outline steps"),
      text: "outline steps",
      messageBaseline: 3,
      startedAt: 100,
      effectiveCollaborationMode: mode,
      assistantFeatureCategoryId: "office",
      goalRuntime: null,
    });
    expect(result.draft.planningIntent).toEqual({
      originalPrompt: "outline steps",
      messageBaseline: 3,
    });
    expect(result.nextGoalRuntime).toBeNull();
  });

  test("applySendDraftIntents starts goalIntent when no runtime yet", () => {
    const mode: ComposerCollaborationMode = {
      pursueGoal: true,
      planning: false,
    };
    const result = applySendDraftIntents({
      draft: baseDraft("finish the report"),
      text: "finish the report",
      messageBaseline: 1,
      startedAt: 200,
      effectiveCollaborationMode: mode,
      assistantFeatureCategoryId: "office",
      goalRuntime: null,
    });
    expect(result.draft.goalIntent).toEqual({
      objective: "finish the report",
      messageBaseline: 1,
    });
    expect(result.nextGoalRuntime).toBeNull();
  });

  test("applySendDraftIntents continues existing goal with hidden prompt", () => {
    const mode: ComposerCollaborationMode = {
      pursueGoal: true,
      planning: false,
    };
    const existing = goalRuntime({ status: "waiting" });
    const result = applySendDraftIntents({
      draft: baseDraft("keep going"),
      text: "keep going",
      messageBaseline: 5,
      startedAt: 300,
      effectiveCollaborationMode: mode,
      assistantFeatureCategoryId: "office",
      goalRuntime: existing,
    });
    expect(result.draft.goalIntent).toBeUndefined();
    expect(result.draft.hiddenSystemPrompt).toBeTruthy();
    expect(result.nextGoalRuntime?.status).toBe("running");
    expect(result.nextGoalRuntime?.lastRunStartedAt).toBe(300);
    expect(result.nextGoalRuntime?.lastRunMessageBaseline).toBe(5);
  });

  test("applySendDraftIntents prepends stall recovery prompt", () => {
    const result = applySendDraftIntents({
      draft: { ...baseDraft("retry"), hiddenSystemPrompt: "base" },
      text: "retry",
      messageBaseline: 0,
      startedAt: 1,
      effectiveCollaborationMode: { planning: false, pursueGoal: false },
      assistantFeatureCategoryId: "office",
      goalRuntime: null,
      stallRecoveryHiddenPrompt: "stall-recovery",
    });
    expect(result.draft.hiddenSystemPrompt).toBe("base\n\nstall-recovery");
  });

  test("buildPlanExecutionRequest only when awaiting approval", () => {
    expect(
      buildPlanExecutionRequest({
        planRuntime: planRuntime({ status: "drafting" }),
        pursueGoal: false,
        messageBaseline: 2,
        approvedAt: 9,
      }),
    ).toBeNull();

    const ready = buildPlanExecutionRequest({
      planRuntime: planRuntime(),
      pursueGoal: true,
      messageBaseline: 4,
      approvedAt: 11,
    });
    expect(ready?.executionMode).toEqual({
      kind: "craft",
      planning: false,
      pursueGoal: true,
    });
    expect(ready?.nextPlanRuntime.status).toBe("executing");
    expect(ready?.nextPlanRuntime.executionBaseline).toBe(4);
    expect(ready?.nextPlanRuntime.approvedAt).toBe(11);
    expect(ready?.executionSystemPrompt.length).toBeGreaterThan(0);
  });

  test("buildGoalResumeRuntime accumulates pause and marks running", () => {
    const paused = goalRuntime({
      status: "paused",
      pauseStartedAt: 1000,
      totalPausedMs: 50,
    });
    const next = buildGoalResumeRuntime({
      runtime: paused,
      messageBaseline: 7,
      now: 1500,
      todos: [
        { id: "1", content: " a ", status: "pending", priority: "medium" },
        { id: "2", content: "  ", status: "pending", priority: "medium" },
      ],
    });
    expect(next?.status).toBe("running");
    expect(next?.totalPausedMs).toBe(550);
    expect(next?.pauseStartedAt).toBeUndefined();
    expect(next?.lastRunMessageBaseline).toBe(7);
    expect(next?.lastKnownTodos).toEqual([
      { id: "1", content: " a ", status: "pending", priority: "medium" },
    ]);
    expect(goalResumeCollaborationMode()).toEqual({
      planning: false,
      pursueGoal: true,
    });
    expect(
      buildGoalResumeRuntime({
        runtime: goalRuntime({ status: "running" }),
        messageBaseline: 0,
      }),
    ).toBeNull();
  });

  test("buildGoalPauseRuntime only for running/waiting", () => {
    expect(
      buildGoalPauseRuntime({
        runtime: goalRuntime({ status: "running" }),
        now: 42,
      }),
    ).toMatchObject({
      status: "paused",
      waitingReason: "user",
      pauseStartedAt: 42,
    });
    expect(
      buildGoalPauseRuntime({
        runtime: goalRuntime({ status: "paused" }),
        now: 1,
      }),
    ).toBeNull();
  });

  test("abort helpers cancel plan or route to pause-goal", () => {
    expect(
      buildAbortPlanRuntime(planRuntime({ status: "executing" })),
    ).toMatchObject({
      status: "blocked",
      blockedReason: "cancelled",
    });
    expect(buildAbortPlanRuntime(planRuntime({ status: "awaiting_approval" }))).toBeNull();

    expect(
      resolveAbortAction({
        chatStreaming: false,
        collaborationKind: "execute",
        goalRuntime: null,
        planRuntime: null,
      }).action,
    ).toBe("noop");

    expect(
      resolveAbortAction({
        chatStreaming: true,
        collaborationKind: "goal",
        goalRuntime: goalRuntime({ status: "running" }),
        planRuntime: null,
      }).action,
    ).toBe("pause-goal");

    const stop = resolveAbortAction({
      chatStreaming: true,
      collaborationKind: "plan",
      goalRuntime: null,
      planRuntime: planRuntime({ status: "drafting" }),
    });
    expect(stop.action).toBe("stop");
    expect(stop.nextPlanRuntime?.status).toBe("blocked");
  });
});
