/**
 * 纯函数和工具函数 - 从session-surface.tsx提取
 * 用于支持session surface的渲染逻辑
 */

import type { UIMessage } from "ai";
import { currentLocale, t } from "../../../../i18n";
import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  TodoItem,
} from "../../../../app/types";

// ============================================================================
// Plan Step Extraction Utilities
// ============================================================================

export type PlanStepItem = {
  id: string;
  content: string;
  status: "pending" | "active" | "completed";
};

export type PlanDetailSection = {
  kind: "risk" | "validation" | "reversibility";
  title: string;
  items: string[];
};

const PLAN_SECTION_BOUNDARY_RE =
  /^(?:#{1,6}\s*)?(?:目标|范围|风险|风险说明|可逆性|验证|验证方式|下一步|执行结果|结果|注意事项)(?:\s|$|:|：)/;
const PLAN_STEP_SECTION_RE =
  /^(?:#{1,6}\s*)?(?:执行步骤|实施步骤|计划步骤|步骤)(?:\s|$|（|:|：)/;
const PLAN_HEADING_RE =
  /^(?:#{1,6}\s*)?(?:plan|计划)(?:\s|$|:|：)/i;

const PLAN_DETAIL_PATTERNS: Array<{
  kind: PlanDetailSection["kind"];
  pattern: RegExp;
}> = [
  {
    kind: "risk",
    pattern:
      /^(?:#{1,6}\s*)?(?:risks?|risk\s+notes?|风险|风险说明)\s*(?:[:：-]\s*)?(.*)$/i,
  },
  {
    kind: "validation",
    pattern:
      /^(?:#{1,6}\s*)?(?:validation|verification|verify|验证|验证方式)\s*(?:[:：-]\s*)?(.*)$/i,
  },
  {
    kind: "reversibility",
    pattern:
      /^(?:#{1,6}\s*)?(?:reversibility|rollback|可逆性|回滚)\s*(?:[:：-]\s*)?(.*)$/i,
  },
];

export function cleanPlanStepLine(line: string) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUsefulPlanStep(step: string) {
  const lower = step.toLowerCase();
  if (!step) return false;
  if (lower.startsWith("#")) return false;
  if (lower.startsWith("risk:")) return false;
  if (lower.startsWith("reversibility:")) return false;
  if (lower.startsWith("impact:")) return false;
  if (lower.startsWith("verification:")) return false;
  if (lower.startsWith("scope:")) return false;
  if (lower.startsWith("note:")) return false;
  if (lower.includes("reversible")) return false;
  if (lower.startsWith("plan mode hard gate")) return false;
  if (lower.startsWith("for this response")) return false;
  if (lower.startsWith("file path")) return false;
  if (lower.includes("<tool_call>")) return false;
  if (lower.includes("file[path=")) return false;
  if (lower.includes("tool_call")) return false;
  if (lower.startsWith("the user wants")) return false;
  if (lower.startsWith("user wants")) return false;
  if (lower.startsWith("let me ")) return false;
  if (lower.startsWith("i should ")) return false;
  if (lower.startsWith("i will ")) return false;
  if (lower.startsWith("i'll ")) return false;
  if (lower.startsWith("用户要求")) return false;
  if (lower.startsWith("我来")) return false;
  if (lower.startsWith("我会")) return false;
  if (lower.startsWith("风险")) return false;
  if (lower.startsWith("覆盖风险")) return false;
  if (lower.includes("风险")) return false;
  if (lower.includes("冲突")) return false;
  if (lower.includes("影响")) return false;
  if (lower.includes("可逆")) return false;
  if (lower.includes("同名文件")) return false;
  if (lower.includes("覆盖")) return false;
  if (lower.startsWith("可逆性")) return false;
  if (lower.startsWith("高可逆")) return false;
  if (lower.startsWith("影响范围")) return false;
  if (lower.startsWith("验证")) return false;
  if (lower.startsWith("创建后读取")) return false;
  if (lower.startsWith("文件路径")) return false;
  if (lower.startsWith("测试内容文案")) return false;
  if (lower.startsWith("不涉及网络")) return false;
  if (lower.startsWith("不涉及")) return false;
  if (lower.startsWith("仅")) return false;
  if (lower.includes("不修改")) return false;
  if (lower.includes("回报")) return false;
  if (lower.includes("告知")) return false;
  if (lower.startsWith("范围")) return false;
  if (lower.startsWith("注意")) return false;
  return true;
}

export function uniquePlanSteps(steps: string[]) {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = step.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function planDetailTitle(kind: PlanDetailSection["kind"]) {
  if (kind === "risk") return t("session.plan_runtime_risk");
  if (kind === "validation") return t("session.plan_runtime_validation");
  return t("session.plan_runtime_reversibility");
}

export function planDetailHeading(line: string) {
  for (const entry of PLAN_DETAIL_PATTERNS) {
    const match = line.match(entry.pattern);
    if (match) {
      return {
        kind: entry.kind,
        remainder: cleanPlanStepLine(match[1] ?? ""),
      };
    }
  }
  return null;
}

export function extractPlanDetailSections(planText: string): PlanDetailSection[] {
  const buffers: Record<PlanDetailSection["kind"], string[]> = {
    risk: [],
    validation: [],
    reversibility: [],
  };
  let currentKind: PlanDetailSection["kind"] | null = null;
  const lines = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const heading = planDetailHeading(line);
    if (heading) {
      currentKind = heading.kind;
      if (heading.remainder) buffers[currentKind].push(heading.remainder);
      continue;
    }
    if (PLAN_STEP_SECTION_RE.test(line) || (PLAN_SECTION_BOUNDARY_RE.test(line) && !currentKind)) {
      currentKind = null;
      continue;
    }
    if (!currentKind) continue;
    if (PLAN_SECTION_BOUNDARY_RE.test(line) && !planDetailHeading(line)) {
      currentKind = null;
      continue;
    }
    const item = cleanPlanStepLine(line);
    if (item) buffers[currentKind].push(item);
  }

  return (Object.keys(buffers) as PlanDetailSection["kind"][])
    .map((kind) => ({
      kind,
      title: planDetailTitle(kind),
      items: uniquePlanSteps(buffers[kind]).slice(0, 3),
    }))
    .filter((section) => section.items.length > 0);
}

export function extractPlanSteps(planText: string): PlanStepItem[] {
  const lines = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sectionSteps: string[] = [];
  let readingStepSection = false;

  for (const line of lines) {
    if (PLAN_STEP_SECTION_RE.test(line)) {
      readingStepSection = true;
      continue;
    }
    if (readingStepSection && PLAN_SECTION_BOUNDARY_RE.test(line)) {
      readingStepSection = false;
      continue;
    }
    if (!readingStepSection) continue;
    if (!/^[-*]\s+|\d+[.)、]\s*/.test(line)) continue;
    const step = cleanPlanStepLine(line);
    if (isUsefulPlanStep(step)) sectionSteps.push(step);
  }

  const planHeadingIndex = lines.findIndex((line) => PLAN_HEADING_RE.test(line));
  const fallbackSource =
    planHeadingIndex >= 0 ? lines.slice(planHeadingIndex + 1) : lines;
  const fallbackSteps =
    sectionSteps.length > 0
      ? sectionSteps
      : fallbackSource
          .filter((line) => /^[-*]\s+|\d+[.)、]\s*/.test(line))
          .map(cleanPlanStepLine)
          .filter(isUsefulPlanStep);

  return uniquePlanSteps(fallbackSteps).slice(0, 5).map((content, index) => ({
    id: `plan-step-${index}-${content.slice(0, 16)}`,
    content,
    status: "pending",
  }));
}

export function inferPlanStepsFromPrompt(prompt: string): PlanStepItem[] {
  const lower = prompt.toLowerCase();
  const isFileTask =
    lower.includes(".md") ||
    lower.includes(".txt") ||
    lower.includes("file") ||
    prompt.includes("文件") ||
    prompt.includes("写入") ||
    prompt.includes("创建");
  const contents = isFileTask
    ? [
        "确认目标文件路径和写入内容",
        "创建或更新文件并写入指定内容",
        "验证文件已生成且内容符合要求",
      ]
    : [
        "确认任务目标和执行范围",
        "按计划完成核心操作",
        "验证结果并向用户汇报",
      ];
  return contents.map((content, index) => ({
    id: `inferred-plan-step-${index}`,
    content,
    status: "pending",
  }));
}

export function resolvePlanStepItems(input: {
  planText: string;
  originalPrompt: string;
  runtimeStatus: CollaborationPlanRuntime["status"];
  todos: TodoItem[];
}) {
  const todoSteps = input.todos
    .filter((todo) => todo.content.trim())
    .map((todo, index): PlanStepItem => {
      const status =
        todo.status === "completed"
          ? "completed"
          : todo.status === "in_progress"
            ? "active"
            : "pending";
      return {
        id: todo.id || `todo-plan-step-${index}`,
        content: todo.content.trim(),
        status,
      };
    });
  if (todoSteps.length > 0) return todoSteps;

  const extractedPlanSteps = extractPlanSteps(input.planText);
  const planSteps =
    extractedPlanSteps.length > 0
      ? extractedPlanSteps
      : inferPlanStepsFromPrompt(input.originalPrompt);
  if (input.runtimeStatus === "completed") {
    return planSteps.map((step) => ({ ...step, status: "completed" as const }));
  }
  if (input.runtimeStatus === "executing") {
    return planSteps.map((step, index) => ({
      ...step,
      status: index === 0 ? "active" : "pending",
    }));
  }
  return planSteps;
}

// ============================================================================
// Message Activity Utilities
// ============================================================================

export function isRecordStringUnknown(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function messageActivityFingerprint(messages: UIMessage[]) {
  return messages
    .map((message) => {
      const partToken = message.parts
        .map((part) => {
          if ("text" in part && typeof part.text === "string") {
            return `${part.type}:${part.text.length}`;
          }
          if (part.type === "dynamic-tool" && isRecordStringUnknown(part)) {
            const state = typeof part.state === "string" ? part.state : "";
            const toolName = typeof part.toolName === "string" ? part.toolName : "";
            return `${part.type}:${toolName}:${state}`;
          }
          return part.type;
        })
        .join(",");
      return `${message.id}:${message.role}:${partToken}`;
    })
    .join("|");
}

export function compactCandidateText(message: UIMessage) {
  if (message.role !== "assistant") return "";
  return message.parts
    .flatMap((part) => {
      if ("text" in part && typeof part.text === "string") return [part.text];
      return [];
    })
    .join("\n")
    .trim();
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isLikelyCompactSummaryMessage(message: UIMessage) {
  const text = compactCandidateText(message);
  if (text.length < 320) return false;
  const headings = [
    "Summary",
    "Current State",
    "Completed",
    "Done",
    "In Progress",
    "Blocked",
    "Key Decisions",
    "Next Steps",
    "Progress",
    t("session.compact_heading_current_state"),
    t("session.compact_heading_summary"),
    t("session.compact_heading_completed"),
    t("session.compact_heading_done"),
    t("session.compact_heading_in_progress"),
    t("session.compact_heading_blocked"),
    t("session.compact_heading_key_decisions"),
    t("session.compact_heading_next_steps"),
    t("session.compact_heading_progress"),
  ];
  const headingHits = headings.filter((heading) => {
    const escapedHeading = escapeRegExp(heading);
    return new RegExp(
      `(^|\\n)\\s*(?:#+\\s*)?${escapedHeading}(?:\\s|[:：]|$)`,
      "i",
    ).test(text);
  }).length;
  return headingHits >= 3;
}

export function filterCompactionMessages(
  messages: UIMessage[],
  compactBoundary: number | null,
) {
  let beforeNextUserAfterBoundary = compactBoundary !== null;
  return messages.filter((message, index) => {
    if (compactBoundary !== null && index >= compactBoundary) {
      if (message.role === "user") beforeNextUserAfterBoundary = false;
      if (
        beforeNextUserAfterBoundary &&
        message.role === "assistant" &&
        isLikelyCompactSummaryMessage(message)
      ) {
        return false;
      }
    }
    return !isLikelyCompactSummaryMessage(message);
  });
}

// ============================================================================
// Goal Runtime Utilities
// ============================================================================

export function goalElapsedMs(runtime: CollaborationGoalRuntime, now: number) {
  if (runtime.status === "paused") {
    const pauseStartedAt = runtime.pauseStartedAt ?? runtime.updatedAt;
    return Math.max(
      0,
      pauseStartedAt - runtime.startedAt - runtime.totalPausedMs,
    );
  }
  if (runtime.status === "waiting") {
    if (runtime.waitingReason === "user") {
      const pauseStartedAt = runtime.pauseStartedAt ?? runtime.updatedAt;
      return Math.max(
        0,
        pauseStartedAt - runtime.startedAt - runtime.totalPausedMs,
      );
    }
    return Math.max(
      0,
      runtime.updatedAt - runtime.startedAt - runtime.totalPausedMs,
    );
  }
  const endAt = runtime.completedAt ?? now;
  return Math.max(0, endAt - runtime.startedAt - runtime.totalPausedMs);
}

export function formatGoalElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minutes}:${secondText}`;
}

export function formatInterruptionElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function buildLocaleRuntimeInstruction() {
  return t("session.runtime_language_requirement", currentLocale());
}

export function buildGoalHiddenSystemPrompt(runtime: CollaborationGoalRuntime) {
  const details: string[] = [];
  if (runtime.summary?.trim()) {
    details.push(`${t("session.goal_hidden_summary_label")} ${runtime.summary.trim()}`);
  }
  if (runtime.currentCheckpoint?.trim()) {
    details.push(`${t("session.goal_hidden_checkpoint_label")} ${runtime.currentCheckpoint.trim()}`);
  }
  if (runtime.completionCriteria?.length) {
    details.push(
      `${t("session.goal_hidden_completion_criteria_label")}\n${runtime.completionCriteria
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  if (runtime.validationCommands?.length) {
    details.push(
      `${t("session.goal_hidden_validation_label")}\n${runtime.validationCommands
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  if (runtime.lastKnownTodos?.length) {
    details.push(
      `${t("session.goal_hidden_todos_label")}\n${runtime.lastKnownTodos
        .map((item) => `- [${item.status}] ${item.content}`)
        .join("\n")}`,
    );
  }
  if (runtime.progressLog?.length) {
    details.push(
      `${t("session.goal_hidden_progress_label")}\n${runtime.progressLog
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  return [
    buildLocaleRuntimeInstruction(),
    "",
    t("session.goal_hidden_continue"),
    "",
    t("session.goal_hidden_objective_label"),
    runtime.objective,
    details.length ? `\n${details.join("\n\n")}` : "",
    "",
    t("session.goal_hidden_success_criterion"),
    t("session.goal_hidden_next_step"),
    t("session.goal_hidden_continue_when_safe"),
    t("session.goal_hidden_track_progress"),
    t("session.goal_hidden_stall_recovery"),
    t("session.goal_hidden_blocker"),
  ].join("\n");
}

export function buildPlanExecutionHiddenSystemPrompt(runtime: CollaborationPlanRuntime) {
  return [
    buildLocaleRuntimeInstruction(),
    "",
    t("session.plan_hidden_execute_now"),
    t("session.plan_hidden_approval_granted"),
    t("session.plan_hidden_use_tools"),
    "",
    t("session.plan_hidden_original_request_label"),
    runtime.originalPrompt,
    "",
    t("session.plan_hidden_approved_plan_label"),
    runtime.planText?.trim() || t("session.plan_runtime_empty"),
  ].join("\n");
}

// ============================================================================
// Helper Utilities
// ============================================================================

export function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function normalizedTodoItems(todos: TodoItem[] | undefined) {
  return (todos ?? []).filter((todo) => todo.content.trim());
}

export function goalCheckpointFromTodos(todos: TodoItem[]) {
  const active = todos.find((todo) => todo.status === "in_progress");
  if (active) return active.content.trim();
  const pending = todos.find((todo) => todo.status === "pending");
  if (pending) return pending.content.trim();
  const completed = [...todos]
    .reverse()
    .find((todo) => todo.status === "completed");
  return completed?.content.trim() ?? "";
}

export function appendGoalProgressLog(
  runtime: CollaborationGoalRuntime,
  runText: string,
) {
  const trimmed = runText.replace(/\s+/g, " ").trim();
  if (!trimmed) return runtime.progressLog;
  const entry = trimmed.length > 400 ? `${trimmed.slice(0, 400).trimEnd()}...` : trimmed;
  const existing = runtime.progressLog ?? [];
  if (existing[existing.length - 1] === entry) return existing;
  return [...existing, entry].slice(-8);
}

export function isGoalIntentRuntime(
  runtime: CollaborationGoalRuntime | null | undefined,
): runtime is CollaborationGoalRuntime {
  return runtime?.source === "goal_intent";
}

export function assistantScenarioDraftToken(id: string) {
  return `[[assistant-scenario:${id}]]`;
}

export function removeAssistantScenarioDraftTokens(value: string) {
  return value.replace(/\[\[assistant-scenario:[^\]]+\]\]\s*/g, "");
}

export function isUserCancelledError(error: { message: string }) {
  return /\b(aborted|abort|cancelled|canceled)\b/i.test(error.message);
}

export function planTextFromMessages(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role === "assistant")
    .map((message) => {
      // Extract text from message parts
      return message.parts
        .filter((part): part is { type: "text"; text: string } => 
          part.type === "text" && "text" in part
        )
        .map((part) => part.text)
        .join(" ");
    })
    .map((text) => text.replace(/^OnMyAgent\s*/i, "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}