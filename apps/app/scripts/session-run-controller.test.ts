import { describe, expect, test } from "bun:test";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerCollaborationMode,
} from "../src/app/types";
import {
  resolveSessionCollaborationKind,
  resolveSessionRunPolicy,
  shouldShowGoalPreview,
  deriveGoalSummary,
  shouldShowGoalRuntime,
  summarizeGoalObjective,
} from "../src/react-app/domains/session/surface/session-run-controller";
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

  test("shows a goal preview only for the current session before its first send", () => {
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
      }),
    ).toBe(true);
    expect(
      shouldShowGoalPreview({
        mode: goalMode,
        goalRuntime: explicitGoalRuntime("running"),
        planRuntime: null,
        dismissed: false,
      }),
    ).toBe(false);
    expect(
      shouldShowGoalPreview({
        mode: goalMode,
        goalRuntime: null,
        planRuntime: planRuntime("drafting"),
        dismissed: false,
      }),
    ).toBe(false);
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
