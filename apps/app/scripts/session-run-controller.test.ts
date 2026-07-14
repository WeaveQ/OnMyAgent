import { describe, expect, test } from "bun:test";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerCollaborationMode,
} from "../src/app/types";
import {
  resolveSessionCollaborationKind,
  resolveSessionRunPolicy,
  shouldShowSessionActivity,
  settleGoalRuntimeAfterRun,
  hasRepeatedGoalAssistantOutput,
  shouldShowGoalPreview,
  deriveGoalSummary,
  shouldShowGoalRuntime,
  summarizeGoalObjective,
  manualStopNoticeKind,
} from "../src/react-app/domains/session/surface/session-run-controller";
import {
  createSessionInterruptionNotice,
  shouldRecordSessionInterruption,
} from "../src/react-app/domains/session/surface/plan-goal/goal-runtime";
import { goalElapsedMs } from "../src/react-app/domains/session/surface/plan-goal/goal-runtime";
import { preferLatestGoalRuntime } from "../src/react-app/domains/session/surface/plan-goal/goal-runtime";
import { setLocale } from "../src/i18n";

const executeMode: ComposerCollaborationMode = {
  kind: "craft",
  planning: false,
  pursueGoal: true,
};

const planMode: ComposerCollaborationMode = {
  kind: "plan",
  planning: true,
  pursueGoal: false,
};

function goalRuntime(
  status: CollaborationGoalRuntime["status"],
): CollaborationGoalRuntime {
  return {
    status,
    objective: "Build the feature",
    messageBaseline: 0,
    startedAt: 100,
    updatedAt: 100,
    totalPausedMs: 0,
  };
}

function explicitGoalRuntime(
  status: CollaborationGoalRuntime["status"],
): CollaborationGoalRuntime {
  return {
    ...goalRuntime(status),
    source: "goal_intent",
  };
}

function planRuntime(
  status: CollaborationPlanRuntime["status"],
): CollaborationPlanRuntime {
  return {
    status,
    originalPrompt: "Plan the feature",
    messageBaseline: 0,
    createdAt: 100,
  };
}

describe("session run controller", () => {
  test("resolves collaboration kinds for execute, ask, plan, and code goal", () => {
    expect(resolveSessionCollaborationKind(executeMode, "office")).toBe("execute");
    expect(resolveSessionCollaborationKind(executeMode, "code")).toBe("execute");
    expect(
      resolveSessionCollaborationKind(
        { kind: "ask", planning: false, pursueGoal: false },
        "office",
      ),
    ).toBe("ask");
    expect(resolveSessionCollaborationKind(planMode, "code")).toBe("plan");
    expect(
      resolveSessionCollaborationKind(
        { planning: false, pursueGoal: true },
        "code",
      ),
    ).toBe("goal");
  });

  test("default access waits for permission and does not expose resume", () => {
    const policy = resolveSessionRunPolicy({
      accessMode: "default",
      collaborationMode: executeMode,
      categoryId: "code",
      activityStatus: "waiting",
      assistantActive: true,
      hasActivePermission: true,
      hasActiveQuestion: false,
      planRuntime: null,
      goalRuntime: goalRuntime("running"),
      stalled: false,
    });

    expect(policy.runState).toBe("waiting-approval");
    expect(policy.canPauseGoal).toBe(true);
    expect(policy.canResumeGoal).toBe(false);
  });

  test("keeps an explicit goal runtime visible after the composer mode changes", () => {
    expect(
      shouldShowGoalRuntime({
        mode: executeMode,
        categoryId: "code",
        goalRuntime: explicitGoalRuntime("waiting"),
        dismissed: false,
      }),
    ).toBe(true);
    expect(
      shouldShowGoalRuntime({
        mode: { planning: false, pursueGoal: true },
        categoryId: "code",
        goalRuntime: explicitGoalRuntime("waiting"),
        dismissed: false,
      }),
    ).toBe(true);
    expect(
      shouldShowGoalRuntime({
        mode: { planning: false, pursueGoal: true },
        categoryId: "office",
        goalRuntime: explicitGoalRuntime("waiting"),
        dismissed: false,
      }),
    ).toBe(true);
    expect(
      resolveSessionCollaborationKind(
        { planning: false, pursueGoal: true },
        "office",
      ),
    ).toBe("goal");
  });

  test("shows a goal preview only after the session has been created", () => {
    const goalMode: ComposerCollaborationMode = {
      planning: false,
      pursueGoal: true,
    };
    expect(
      shouldShowGoalPreview({
        mode: goalMode,
        goalRuntime: null,
        planRuntime: null,
        dismissed: false,
        hasCreatedSession: false,
      }),
    ).toBe(false);
    expect(
      shouldShowGoalPreview({
        mode: goalMode,
        goalRuntime: null,
        planRuntime: null,
        dismissed: false,
        hasCreatedSession: true,
      }),
    ).toBe(true);
    expect(
      shouldShowGoalPreview({
        mode: goalMode,
        goalRuntime: explicitGoalRuntime("running"),
        planRuntime: null,
        dismissed: false,
        hasCreatedSession: true,
      }),
    ).toBe(false);
    expect(
      shouldShowGoalPreview({
        mode: goalMode,
        goalRuntime: null,
        planRuntime: planRuntime("drafting"),
        dismissed: false,
        hasCreatedSession: true,
      }),
    ).toBe(false);
  });

  test("settles an idle goal run even when it produced no assistant text", () => {
    const settled = settleGoalRuntimeAfterRun({
      runtime: explicitGoalRuntime("running"),
      todos: [],
      runText: "",
      now: 200,
    });

    expect(settled.status).toBe("waiting");
    expect(settled.waitingReason).toBe("idle");
    expect(settled.updatedAt).toBe(200);
  });

  test("detects repeated final output within a single goal run", () => {
    expect(hasRepeatedGoalAssistantOutput(["已确认。", "已确认。"])).toBe(true);
    expect(hasRepeatedGoalAssistantOutput(["已确认。", "下一步继续验证。"])).toBe(false);
  });

  test("full access does not treat permission requests as blocking", () => {
    const policy = resolveSessionRunPolicy({
      accessMode: "full",
      collaborationMode: executeMode,
      categoryId: "code",
      activityStatus: "idle",
      assistantActive: false,
      hasActivePermission: true,
      hasActiveQuestion: false,
      planRuntime: null,
      goalRuntime: goalRuntime("paused"),
      stalled: false,
    });

    expect(policy.runState).toBe("paused");
    expect(policy.canResumeGoal).toBe(true);
  });

  test("a paused goal suppresses a stale streaming indicator", () => {
    expect(
      shouldShowSessionActivity({
        chatStreaming: true,
        activityStatus: "thinking",
        goalRuntime: goalRuntime("paused"),
        stopRequested: false,
        runInterrupted: false,
      }),
    ).toBe(false);
    expect(
      shouldShowSessionActivity({
        chatStreaming: true,
        activityStatus: "thinking",
        goalRuntime: goalRuntime("running"),
        stopRequested: false,
        runInterrupted: false,
      }),
    ).toBe(true);
  });

  test("a local stop suppresses stale streaming activity", () => {
    expect(
      shouldShowSessionActivity({
        chatStreaming: true,
        activityStatus: "idle",
        goalRuntime: null,
        stopRequested: true,
        runInterrupted: false,
      }),
    ).toBe(false);
  });

  test("a terminal notice keeps a stopped run hidden after the stop latch clears", () => {
    expect(
      shouldShowSessionActivity({
        chatStreaming: true,
        activityStatus: "idle",
        goalRuntime: null,
        stopRequested: false,
        runInterrupted: true,
      }),
    ).toBe(false);
  });

  test("uses elapsed stop notices only for goal collaboration", () => {
    expect(manualStopNoticeKind("execute")).toBe("cancelled");
    expect(manualStopNoticeKind("ask")).toBe("cancelled");
    expect(manualStopNoticeKind("plan")).toBe("cancelled");
    expect(manualStopNoticeKind("goal")).toBe("stopped");

    expect(
      createSessionInterruptionNotice({
        sessionId: "ses_1",
        kind: "cancelled",
        runKey: "ses_1:1000",
        afterMessageCount: 4,
        runStartedAt: 1_000,
        now: 6_000,
      }).elapsedMs,
    ).toBeUndefined();
    expect(
      createSessionInterruptionNotice({
        sessionId: "ses_1",
        kind: "stopped",
        runKey: "ses_1:1000",
        afterMessageCount: 4,
        runStartedAt: 1_000,
        now: 6_000,
      }).elapsedMs,
    ).toBe(5_000);
  });

  test("uses cumulative goal runtime after a resumed run is stopped", () => {
    const elapsedMs = goalElapsedMs(
      {
        ...explicitGoalRuntime("running"),
        startedAt: 1_000,
        updatedAt: 16_000,
        totalPausedMs: 5_000,
        lastRunStartedAt: 16_000,
      },
      25_000,
    );

    expect(elapsedMs).toBe(19_000);
    expect(
      createSessionInterruptionNotice({
        sessionId: "ses_1",
        kind: "stopped",
        runKey: "ses_1:16000",
        afterMessageCount: 8,
        runStartedAt: 16_000,
        now: 25_000,
        elapsedMs,
      }).elapsedMs,
    ).toBe(19_000);
  });

  test("paused goals can resume only when the run is otherwise idle", () => {
    const idlePolicy = resolveSessionRunPolicy({
      accessMode: "default",
      collaborationMode: executeMode,
      categoryId: "code",
      activityStatus: "idle",
      assistantActive: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      planRuntime: null,
      goalRuntime: goalRuntime("paused"),
      stalled: false,
    });
    const waitingQuestionPolicy = resolveSessionRunPolicy({
      accessMode: "default",
      collaborationMode: executeMode,
      categoryId: "code",
      activityStatus: "idle",
      assistantActive: false,
      hasActivePermission: false,
      hasActiveQuestion: true,
      planRuntime: null,
      goalRuntime: goalRuntime("paused"),
      stalled: false,
    });

    expect(idlePolicy.canResumeGoal).toBe(true);
    expect(waitingQuestionPolicy.runState).toBe("waiting-user-answer");
    expect(waitingQuestionPolicy.canResumeGoal).toBe(false);
  });

  test("executing plans and stalled active work do not expose goal resume", () => {
    const policy = resolveSessionRunPolicy({
      accessMode: "default",
      collaborationMode: planMode,
      categoryId: "code",
      activityStatus: "waiting",
      assistantActive: true,
      hasActivePermission: false,
      hasActiveQuestion: false,
      planRuntime: planRuntime("executing"),
      goalRuntime: goalRuntime("waiting"),
      stalled: true,
    });

    expect(policy.runState).toBe("stalled");
    expect(policy.canResumeGoal).toBe(false);
  });

  test("stalled waiting goals do not expose continue even when activity is quiet", () => {
    const policy = resolveSessionRunPolicy({
      accessMode: "default",
      collaborationMode: executeMode,
      categoryId: "code",
      activityStatus: "idle",
      assistantActive: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      planRuntime: null,
      goalRuntime: goalRuntime("waiting"),
      stalled: true,
    });

    expect(policy.runState).toBe("stalled");
    expect(policy.canResumeGoal).toBe(false);
  });

  test("does not append a cancelled notice after the same run was explicitly stopped", () => {
    expect(
      shouldRecordSessionInterruption({
        existing: [
          {
            id: "ses_1:stopped",
            kind: "stopped",
            afterMessageCount: 4,
            runKey: "ses_1:100",
            runStartedAt: 100,
          },
        ],
        candidate: {
          id: "ses_1:cancelled",
          kind: "cancelled",
          afterMessageCount: 5,
          runKey: "ses_1:100",
          runStartedAt: 200,
        },
      }),
    ).toBe(false);
  });

  test("records a terminal notice for a genuinely new run", () => {
    expect(
      shouldRecordSessionInterruption({
        existing: [
          {
            id: "ses_1:cancelled:first",
            kind: "cancelled",
            afterMessageCount: 4,
            runKey: "ses_1:100",
          },
        ],
        candidate: {
          id: "ses_1:cancelled:second",
          kind: "cancelled",
          afterMessageCount: 8,
          runKey: "ses_1:200",
        },
      }),
    ).toBe(true);
  });

  test("keeps elapsed goal time moving while the runtime is compacting", () => {
    expect(
      goalElapsedMs(
        {
          ...explicitGoalRuntime("waiting"),
          startedAt: 100,
          updatedAt: 200,
          waitingReason: "compacting",
        },
        500,
      ),
    ).toBe(400);
  });

  test("does not let a stale paused prop overwrite an optimistic goal resume", () => {
    const optimisticRunning = {
      ...explicitGoalRuntime("running"),
      updatedAt: 200,
    };
    const stalePaused = {
      ...explicitGoalRuntime("paused"),
      updatedAt: 100,
    };

    expect(preferLatestGoalRuntime(optimisticRunning, stalePaused)).toBe(
      optimisticRunning,
    );
    expect(
      preferLatestGoalRuntime(optimisticRunning, {
        ...stalePaused,
        updatedAt: optimisticRunning.updatedAt,
      }),
    ).toBe(optimisticRunning);
  });

  test("summarizes pasted goal objectives as readable text", () => {
    expect(
      summarizeGoalObjective({
        objective:
          "[pasted text 9flg · 77 lines]\n```ts\nconst noisy = true;\n```\n创建项目管理工具并完成自测",
      }),
    ).toBe("创建项目管理工具并完成自测");
  });

  test("derives a concise goal summary from structured requirements", () => {
    setLocale("zh");
    expect(
      deriveGoalSummary(
        "项目要求：\n1. 新建文件夹 long-goal-project-manager-demo，不要改动当前工作区已有业务代码。\n2. 使用 Vite + React + TypeScript。",
      ),
    ).toBe("新建文件夹 long-goal-project-manager-demo，不要改动当前工作区已有业务代码");
    expect(
      deriveGoalSummary(
        "项目要求：\n1. 新建文件夹 long-goal-project-manager-demo。\n2. 创建项目管理 Demo 应用。\n3. 自测并验证通过。",
      ),
    ).toBe("搭建项目管理 Demo 应用并完成验证");
  });

  test("removes assistant/user framing from restored goal summaries", () => {
    setLocale("zh");
    expect(
      summarizeGoalObjective({
        objective: "fallback",
        summary:
          "You 项目要求：1. 新建文件夹 long-goal-project-manager-demo，不要改动当前工作区已有业务代码。",
      }),
    ).toBe("新建文件夹 long-goal-project-manager-demo，不要改动当前工作区已有业务代码。");
  });
});
