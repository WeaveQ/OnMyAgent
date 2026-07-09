import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerAccessMode,
  ComposerCollaborationMode,
} from "../../../../app/types";
import type { AssistantCategoryId } from "./personal-assistant-config";
import type { SessionActivityStatus } from "../status/session-activity-store";
import { t } from "../../../../i18n";

export type SessionCollaborationKind = "execute" | "ask" | "plan" | "goal";

export type SessionRunState =
  | "idle"
  | "thinking"
  | "responding"
  | "running-tool"
  | "waiting-approval"
  | "waiting-user-answer"
  | "compacting"
  | "paused"
  | "stalled"
  | "completed"
  | "cancelled"
  | "failed";

export type SessionRunPolicy = {
  accessMode: ComposerAccessMode;
  collaborationKind: SessionCollaborationKind;
  runState: SessionRunState;
  canPauseGoal: boolean;
  canResumeGoal: boolean;
  canClearGoal: boolean;
};

export function resolveSessionCollaborationKind(
  mode: ComposerCollaborationMode,
  categoryId: AssistantCategoryId,
): SessionCollaborationKind {
  if (mode.kind === "ask") return "ask";
  if (mode.kind === "plan" || mode.planning) return "plan";
  if (
    mode.pursueGoal &&
    !mode.planning &&
    categoryId === "code" &&
    mode.kind !== "craft"
  ) {
    return "goal";
  }
  return "execute";
}

export function shouldShowGoalRuntime(input: {
  mode: ComposerCollaborationMode;
  categoryId: AssistantCategoryId;
  goalRuntime: CollaborationGoalRuntime | null;
  dismissed: boolean;
}) {
  return (
    !input.dismissed &&
    input.goalRuntime?.source === "goal_intent" &&
    resolveSessionCollaborationKind(input.mode, input.categoryId) === "goal"
  );
}

export function summarizeGoalObjective(input: {
  objective: string;
  summary?: string;
}) {
  const source = input.summary?.trim() || input.objective;
  const withoutCode = source
    .replace(/\[pasted text[^\]]*\]/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripGoalSummaryPrefixes(withoutCode);
}

export function deriveGoalSummary(objective: string) {
  const normalized = summarizeGoalObjective({ objective });
  const inferred = inferGoalSummary(normalized);
  if (inferred) return inferred;
  const sentence =
    normalized
      .split(/(?:。|！|？|\.|\n)/)
      .map((item) => item.trim())
      .find(Boolean) ?? normalized;
  if (sentence.length <= 56) return sentence;
  return `${sentence.slice(0, 56).trimEnd()}...`;
}

function inferGoalSummary(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const projectManagement = "\u9879\u76ee\u7ba1\u7406";
  const app = "\u5e94\u7528";
  const selfTest = "\u81ea\u6d4b";
  const validation = "\u9a8c\u8bc1";
  const thisProject = "\u8fd9\u4e2a\u9879\u76ee";
  const projectPurposeQuestion = "\u9879\u76ee\u662f\u505a\u4ec0\u4e48";
  const whatFor = "\u505a\u4ec0\u4e48";
  const purpose = "\u7528\u9014";
  const wantsProjectManagementDemo =
    (normalized.includes(projectManagement) || lower.includes("project manager")) &&
    (normalized.includes("demo") ||
      normalized.includes("Demo") ||
      normalized.includes(app) ||
      lower.includes("app"));
  if (wantsProjectManagementDemo) {
    return normalized.includes(selfTest) || normalized.includes(validation)
      ? t("session.goal_summary_project_manager_demo_validated")
      : t("session.goal_summary_project_manager_demo");
  }
  if (
    (normalized.includes(thisProject) || normalized.includes(projectPurposeQuestion)) &&
    (normalized.includes(whatFor) || normalized.includes(purpose))
  ) {
    return t("session.goal_summary_project_purpose");
  }
  return "";
}

function stripGoalSummaryPrefixes(value: string) {
  let next = value.trim();
  for (let index = 0; index < 4; index += 1) {
    const previous = next;
    next = next
      .replace(/^(?:You|User|The user(?:\s+(?:wants|asked))?(?:\s+me)?(?:\s+to)?|Objective|Goal|Task)\s*(?::|\uff1a)?\s*/i, "")
      .replace(/^(?:\u76ee\u6807|\u4efb\u52a1|\u9879\u76ee\u8981\u6c42|\u9700\u6c42|\u7528\u6237\u8981\u6c42|\u7528\u6237\u5e0c\u671b)\s*[:\uff1a]?\s*/i, "")
      .replace(/^\d+[.)、]\s*/, "")
      .replace(/^[-*]\s*/, "")
      .trim();
    if (next === previous) return next;
  }
  return next;
}

export function resolveSessionRunPolicy(input: {
  accessMode: ComposerAccessMode;
  collaborationMode: ComposerCollaborationMode;
  categoryId: AssistantCategoryId;
  activityStatus: SessionActivityStatus;
  assistantActive: boolean;
  hasActivePermission: boolean;
  hasActiveQuestion: boolean;
  planRuntime: CollaborationPlanRuntime | null;
  goalRuntime: CollaborationGoalRuntime | null;
  stalled: boolean;
}): SessionRunPolicy {
  const hasBlockingPermission =
    input.accessMode !== "full" && input.hasActivePermission;
  const collaborationKind = resolveSessionCollaborationKind(
    input.collaborationMode,
    input.categoryId,
  );
  const goalRuntime = input.goalRuntime;
  const runState = resolveSessionRunState({
    ...input,
    hasActivePermission: hasBlockingPermission,
  });
  const goalPaused = goalRuntime?.status === "paused";
  const goalWaiting = goalRuntime?.status === "waiting";
  const blocked =
    runState === "waiting-approval" ||
    runState === "waiting-user-answer" ||
    runState === "compacting" ||
    runState === "stalled" ||
    input.assistantActive;

  return {
    accessMode: input.accessMode,
    collaborationKind,
    runState,
    canPauseGoal:
      Boolean(goalRuntime) &&
      !goalPaused &&
      goalRuntime?.status !== "completed" &&
      (input.assistantActive || goalRuntime?.status === "running"),
    canResumeGoal: Boolean(goalRuntime) && !blocked && (goalPaused || goalWaiting),
    canClearGoal: Boolean(goalRuntime),
  };
}

function resolveSessionRunState(input: {
  activityStatus: SessionActivityStatus;
  assistantActive: boolean;
  hasActivePermission: boolean;
  hasActiveQuestion: boolean;
  planRuntime: CollaborationPlanRuntime | null;
  goalRuntime: CollaborationGoalRuntime | null;
  stalled: boolean;
}): SessionRunState {
  if (input.hasActivePermission) return "waiting-approval";
  if (input.hasActiveQuestion) return "waiting-user-answer";
  if (input.activityStatus === "compacting") return "compacting";
  if (input.stalled) return "stalled";
  if (input.activityStatus === "error") return "failed";
  if (input.assistantActive) {
    if (input.activityStatus === "responding") return "responding";
    if (input.activityStatus === "waiting") return "running-tool";
    return "thinking";
  }
  if (input.goalRuntime?.status === "paused") return "paused";
  if (input.goalRuntime?.status === "completed") return "completed";
  if (input.planRuntime?.status === "completed") return "completed";
  return "idle";
}
