/** Plan text parsing for collaboration plan runtime — pure helpers. */
import type { UIMessage } from "ai";

import type {
  CollaborationPlanRuntime,
  TodoItem,
} from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { messageToReadableText } from "../session-surface-model";

export function planTextFromMessages(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role === "assistant")
    .map(messageToReadableText)
    .map((text) => text.replace(/^OnMyAgent\s*/i, "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

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
  /^(?:#{1,6}\s*)?(?:\u76ee\u6807|\u8303\u56f4|\u98ce\u9669|\u98ce\u9669\u8bf4\u660e|\u53ef\u9006\u6027|\u9a8c\u8bc1|\u9a8c\u8bc1\u65b9\u5f0f|\u4e0b\u4e00\u6b65|\u6267\u884c\u7ed3\u679c|\u7ed3\u679c|\u6ce8\u610f\u4e8b\u9879)(?:\s|$|:|\uff1a)/;
const PLAN_STEP_SECTION_RE =
  /^(?:#{1,6}\s*)?(?:\u6267\u884c\u6b65\u9aa4|\u5b9e\u65bd\u6b65\u9aa4|\u8ba1\u5212\u6b65\u9aa4|\u6b65\u9aa4)(?:\s|$|\uff08|:|\uff1a)/;
const PLAN_HEADING_RE =
  /^(?:#{1,6}\s*)?(?:plan|\u8ba1\u5212)(?:\s|$|:|\uff1a)/i;
const PLAN_DETAIL_PATTERNS: Array<{
  kind: PlanDetailSection["kind"];
  pattern: RegExp;
}> = [
  {
    kind: "risk",
    pattern:
      /^(?:#{1,6}\s*)?(?:risks?|risk\s+notes?|\u98ce\u9669|\u98ce\u9669\u8bf4\u660e)\s*(?:[:\uff1a-]\s*)?(.*)$/i,
  },
  {
    kind: "validation",
    pattern:
      /^(?:#{1,6}\s*)?(?:validation|verification|verify|\u9a8c\u8bc1|\u9a8c\u8bc1\u65b9\u5f0f)\s*(?:[:\uff1a-]\s*)?(.*)$/i,
  },
  {
    kind: "reversibility",
    pattern:
      /^(?:#{1,6}\s*)?(?:reversibility|rollback|\u53ef\u9006\u6027|\u56de\u6eda)\s*(?:[:\uff1a-]\s*)?(.*)$/i,
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
  if (lower.startsWith("\u7528\u6237\u8981\u6c42")) return false;
  if (lower.startsWith("\u6211\u6765")) return false;
  if (lower.startsWith("\u6211\u4f1a")) return false;
  if (lower.startsWith("\u98ce\u9669")) return false;
  if (lower.startsWith("\u8986\u76d6\u98ce\u9669")) return false;
  if (lower.includes("\u98ce\u9669")) return false;
  if (lower.includes("\u51b2\u7a81")) return false;
  if (lower.includes("\u5f71\u54cd")) return false;
  if (lower.includes("\u53ef\u9006")) return false;
  if (lower.includes("\u540c\u540d\u6587\u4ef6")) return false;
  if (lower.includes("\u8986\u76d6")) return false;
  if (lower.startsWith("\u53ef\u9006\u6027")) return false;
  if (lower.startsWith("\u9ad8\u53ef\u9006")) return false;
  if (lower.startsWith("\u5f71\u54cd\u8303\u56f4")) return false;
  if (lower.startsWith("\u9a8c\u8bc1")) return false;
  if (lower.startsWith("\u521b\u5efa\u540e\u8bfb\u53d6")) return false;
  if (lower.startsWith("\u6587\u4ef6\u8def\u5f84")) return false;
  if (lower.startsWith("\u6d4b\u8bd5\u5185\u5bb9\u6587\u6848")) return false;
  if (lower.startsWith("\u4e0d\u6d89\u53ca\u7f51\u7edc")) return false;
  if (lower.startsWith("\u4e0d\u6d89\u53ca")) return false;
  if (lower.startsWith("\u4ec5")) return false;
  if (lower.includes("\u4e0d\u4fee\u6539")) return false;
  if (lower.includes("\u56de\u62a5")) return false;
  if (lower.includes("\u544a\u77e5")) return false;
  if (lower.startsWith("\u8303\u56f4")) return false;
  if (lower.startsWith("\u6ce8\u610f")) return false;
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
    prompt.includes("\u6587\u4ef6") ||
    prompt.includes("\u5199\u5165") ||
    prompt.includes("\u521b\u5efa");
  const contents = isFileTask
    ? [
        "\u786e\u8ba4\u76ee\u6807\u6587\u4ef6\u8def\u5f84\u548c\u5199\u5165\u5185\u5bb9",
        "\u521b\u5efa\u6216\u66f4\u65b0\u6587\u4ef6\u5e76\u5199\u5165\u6307\u5b9a\u5185\u5bb9",
        "\u9a8c\u8bc1\u6587\u4ef6\u5df2\u751f\u6210\u4e14\u5185\u5bb9\u7b26\u5408\u8981\u6c42",
      ]
    : [
        "\u786e\u8ba4\u4efb\u52a1\u76ee\u6807\u548c\u6267\u884c\u8303\u56f4",
        "\u6309\u8ba1\u5212\u5b8c\u6210\u6838\u5fc3\u64cd\u4f5c",
        "\u9a8c\u8bc1\u7ed3\u679c\u5e76\u5411\u7528\u6237\u6c47\u62a5",
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

