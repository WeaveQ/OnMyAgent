/**
 * Pure form / schedule helpers for the automation page.
 * UI components stay in automation-page.tsx; this module is unit-tested without React.
 */
import type { ComposerAccessMode, ModelRef } from "@/app/types";
import type { OnMyAgentAutomationTaskItem } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import {
  isAutomationScheduleTime,
  type AutomationCycle,
  type AutomationFrequencyMode,
  type AutomationTemplate,
} from "./automation-model";

export type IntervalUnit = "minutes" | "hours" | "days";

export type AutomationFormState = {
  title: string;
  prompt: string;
  workspaceDirectory: string;
  model: ModelRef | null;
  agentId: string;
  accessMode: ComposerAccessMode;
  frequencyMode: AutomationFrequencyMode;
  day: AutomationCycle;
  time: string;
  intervalValue: string;
  intervalUnit: IntervalUnit;
  weekdays: number[];
  onceDate: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
};

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function automationFrequencyLabel(mode: AutomationFrequencyMode) {
  switch (mode) {
    case "weekly":
      return t("automation.frequency_weekly");
    case "interval":
      return t("automation.frequency_interval");
    case "once":
      return t("automation.frequency_once");
  }
}

export function automationCycleLabel(cycle: AutomationCycle) {
  switch (cycle) {
    case "daily":
      return t("automation.day_daily");
    case "weekly":
      return t("automation.day_weekly");
    case "biweekly":
      return t("automation.day_biweekly");
    case "monthly":
      return t("automation.day_monthly");
    case "yearly":
      return t("automation.day_yearly");
  }
}

export function automationScheduleLabel(cycle: AutomationCycle, time: string) {
  switch (cycle) {
    case "daily":
      return t("automation.schedule_daily_at", { time });
    case "weekly":
      return t("automation.schedule_weekly_at", { time });
    case "biweekly":
      return t("automation.schedule_biweekly_at", { time });
    case "monthly":
      return t("automation.schedule_monthly_at", { time });
    case "yearly":
      return t("automation.schedule_yearly_at", { time });
  }
}

export function automationWeekdayLabel(weekday: number) {
  switch (weekday) {
    case 1:
      return t("automation.weekday_1");
    case 2:
      return t("automation.weekday_2");
    case 3:
      return t("automation.weekday_3");
    case 4:
      return t("automation.weekday_4");
    case 5:
      return t("automation.weekday_5");
    case 6:
      return t("automation.weekday_6");
    case 7:
      return t("automation.weekday_7");
    default:
      return String(weekday);
  }
}

export function localDateValue(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultOnceDate(now = Date.now()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return localDateValue(tomorrow.getTime());
}

export function createEmptyFormState(defaultModel: ModelRef | null = null): AutomationFormState {
  return {
    title: "",
    prompt: "",
    workspaceDirectory: "",
    model: defaultModel,
    agentId: "",
    accessMode: "default",
    frequencyMode: "weekly",
    day: "daily",
    time: "09:00",
    intervalValue: "1",
    intervalUnit: "hours",
    weekdays: [...ALL_WEEKDAYS],
    onceDate: defaultOnceDate(),
    effectiveStartDate: "",
    effectiveEndDate: "",
  };
}

export function hasAutomationModel(model: ModelRef | null | undefined): model is ModelRef {
  return Boolean(model?.providerID?.trim() && model?.modelID?.trim());
}

export function intervalParts(
  intervalMinutes?: number,
): Pick<AutomationFormState, "intervalValue" | "intervalUnit"> {
  if (!intervalMinutes || intervalMinutes % 60 !== 0) {
    return { intervalValue: String(intervalMinutes ?? 60), intervalUnit: "minutes" };
  }
  if (intervalMinutes % (24 * 60) === 0) {
    return { intervalValue: String(intervalMinutes / (24 * 60)), intervalUnit: "days" };
  }
  return { intervalValue: String(intervalMinutes / 60), intervalUnit: "hours" };
}

export function formStateFromTemplate(
  template: AutomationTemplate,
  defaultModel: ModelRef | null = null,
  title: string,
  prompt: string,
): AutomationFormState {
  return {
    ...createEmptyFormState(defaultModel),
    title,
    prompt,
    frequencyMode: template.defaultSchedule.mode,
    day: template.defaultSchedule.day,
    time: template.defaultSchedule.time,
  };
}

/** Localized title/prompt wrapper used by the automation page host. */
export function formStateFromTemplateLocalized(
  template: AutomationTemplate,
  defaultModel: ModelRef | null = null,
): AutomationFormState {
  return formStateFromTemplate(
    template,
    defaultModel,
    t(template.titleKey),
    t(template.promptKey),
  );
}

export function selectAgentTemplateById(
  registry: { templates: ReadonlyArray<{ id: string }> },
  agentId: string,
) {
  return registry.templates.find((template) => template.id === agentId) ?? null;
}

export function formStateFromAutomation(
  item: OnMyAgentAutomationTaskItem,
  fallbackModel: ModelRef | null = null,
): AutomationFormState {
  return {
    title: item.title,
    prompt: item.prompt,
    workspaceDirectory: item.workspaceDirectory ?? "",
    model: item.model ?? item.agent?.model ?? fallbackModel,
    agentId: item.agent?.id ?? "",
    accessMode: item.accessMode ?? "default",
    frequencyMode: item.schedule.mode,
    day: item.schedule.day,
    time: item.schedule.time,
    ...intervalParts(item.schedule.intervalMinutes),
    weekdays: item.schedule.weekdays?.slice() ?? [...ALL_WEEKDAYS],
    onceDate: item.schedule.onceAt ? localDateValue(item.schedule.onceAt) : defaultOnceDate(),
    effectiveStartDate: item.effectiveRange.startDate ?? "",
    effectiveEndDate: item.effectiveRange.endDate ?? "",
  };
}

export function intervalMinutes(form: AutomationFormState) {
  const value = Number.parseInt(form.intervalValue, 10);
  if (!Number.isInteger(value) || value <= 0) return null;
  if (form.intervalUnit === "days") return value * 24 * 60;
  if (form.intervalUnit === "hours") return value * 60;
  return value;
}

export function isIntervalUnit(value: string): value is IntervalUnit {
  return value === "minutes" || value === "hours" || value === "days";
}

export function onceAt(form: AutomationFormState) {
  if (!form.onceDate || !isAutomationScheduleTime(form.time)) return null;
  const value = new Date(`${form.onceDate}T${form.time}:00`).getTime();
  return Number.isFinite(value) ? value : null;
}

export function isEffectiveRangeValid(form: AutomationFormState) {
  if (!form.effectiveStartDate || !form.effectiveEndDate) return true;
  return form.effectiveStartDate <= form.effectiveEndDate;
}

export function isScheduleValid(form: AutomationFormState, now = Date.now()) {
  if (!isAutomationScheduleTime(form.time)) return false;
  if (form.frequencyMode === "interval") {
    const minutes = intervalMinutes(form);
    return minutes !== null && minutes >= 5 && form.weekdays.length > 0;
  }
  if (form.frequencyMode === "once") {
    const timestamp = onceAt(form);
    return timestamp !== null && timestamp > now;
  }
  return true;
}

export function isFormValid(form: AutomationFormState, now = Date.now()) {
  if (!form.title.trim() || !form.prompt.trim() || !isAutomationScheduleTime(form.time)) return false;
  if (!hasAutomationModel(form.model)) return false;
  if (!isEffectiveRangeValid(form)) return false;
  return isScheduleValid(form, now);
}

/** Prefer day/hour friendly labels for interval schedules. */
export function scheduleLabel(schedule: OnMyAgentAutomationTaskItem["schedule"]) {
  if (schedule.mode === "once") {
    return schedule.onceAt
      ? t("automation.schedule_once_datetime", {
          time: new Date(schedule.onceAt).toLocaleString(),
        })
      : t("automation.schedule_once_at", { time: schedule.time });
  }
  if (schedule.mode === "interval") {
    const minutes = schedule.intervalMinutes ?? 60;
    if (minutes % (24 * 60) === 0) {
      return t("automation.schedule_interval_days", { days: minutes / (24 * 60) });
    }
    if (minutes % 60 === 0) {
      return t("automation.schedule_interval_hours", { hours: minutes / 60 });
    }
    return t("automation.schedule_interval_minutes", { minutes });
  }
  return automationScheduleLabel(schedule.day, schedule.time);
}

export function nextRunLabel(item: OnMyAgentAutomationTaskItem, now = Date.now()) {
  if (!item.enabled) return t("automation.status_paused");
  if (!item.nextRunAt) return t("automation.no_next_run");
  const delta = Math.max(0, item.nextRunAt - now);
  const hours = Math.floor(delta / 3_600_000);
  if (hours >= 24) return t("automation.starts_in_days", { days: Math.ceil(hours / 24) });
  if (hours > 0) return t("automation.starts_in_hours", { hours });
  return t("automation.starts_in_minutes", { minutes: Math.max(1, Math.ceil(delta / 60_000)) });
}

export function automationDisplayId(
  item: OnMyAgentAutomationTaskItem,
  groupName?: string,
) {
  const LEGACY_AUTOMATION_GROUP_PREFIX = "\u81EA\u52A8\u5316\u4EFB\u52A1-"; // 自动化任务-
  const AUTOMATION_GROUP_PREFIX = "automation-task-";
  if (groupName?.startsWith(LEGACY_AUTOMATION_GROUP_PREFIX)) {
    return `automation-${groupName.slice(LEGACY_AUTOMATION_GROUP_PREFIX.length)}`;
  }
  if (groupName?.startsWith(AUTOMATION_GROUP_PREFIX)) {
    return `automation-${groupName.slice(AUTOMATION_GROUP_PREFIX.length)}`;
  }
  const date = new Date(item.createdAt);
  const values = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ].map((value) => String(value).padStart(2, "0"));
  return `automation-${values.join("-")}`;
}

export function effectiveRangeLabel(item: OnMyAgentAutomationTaskItem) {
  const { startDate, endDate } = item.effectiveRange;
  if (startDate && endDate) {
    return t("automation.effective_range_between", { startDate, endDate });
  }
  if (startDate) return t("automation.effective_range_from", { startDate });
  if (endDate) return t("automation.effective_range_until", { endDate });
  return null;
}

export function automationCreatedDate(
  timestamp: number,
  locale = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined,
) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(timestamp);
}

export function relativeRunTime(
  timestamp: number,
  now = Date.now(),
  locale = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined,
) {
  const deltaSeconds = Math.round((timestamp - now) / 1_000);
  const absoluteSeconds = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absoluteSeconds < 60) return formatter.format(deltaSeconds, "second");
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) return formatter.format(deltaMinutes, "minute");
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, "hour");
  return formatter.format(Math.round(deltaHours / 24), "day");
}

export function workspaceDirectoryLabel(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return t("automation.workspace_default");
  return trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
}

/**
 * Structure free-text prompts into a goal/output/constraints skeleton.
 * Copy keys are passed in so tests can inject fixed markers without i18n.
 */
export function optimizeAutomationPrompt(
  raw: string,
  copy: {
    heading: string;
    sectionGoal: string;
    alreadyMarker: string;
    sectionOutput: string;
    outputStructure: string;
    outputPlaceholder: string;
    outputNextSteps: string;
    sectionConstraints: string;
    constraintNoFabricate: string;
    constraintConfirmRisk: string;
  },
): string {
  const text = raw.trim();
  if (!text) return text;
  if (
    text.includes(copy.heading) ||
    text.includes(copy.sectionGoal) ||
    text.includes("## Goal") ||
    new RegExp(
      `^#\\s*${copy.alreadyMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "m",
    ).test(text)
  ) {
    return text;
  }
  return [
    copy.heading,
    "",
    copy.sectionGoal,
    text,
    "",
    copy.sectionOutput,
    copy.outputStructure,
    copy.outputPlaceholder,
    copy.outputNextSteps,
    "",
    copy.sectionConstraints,
    copy.constraintNoFabricate,
    copy.constraintConfirmRisk,
  ].join("\n");
}

export function optimizeAutomationPromptWithI18n(raw: string): string {
  return optimizeAutomationPrompt(raw, {
    heading: t("automation.optimize_heading"),
    sectionGoal: t("automation.optimize_section_goal"),
    alreadyMarker: t("automation.optimize_already_marker"),
    sectionOutput: t("automation.optimize_section_output"),
    outputStructure: t("automation.optimize_output_structure"),
    outputPlaceholder: t("automation.optimize_output_placeholder"),
    outputNextSteps: t("automation.optimize_output_next_steps"),
    sectionConstraints: t("automation.optimize_section_constraints"),
    constraintNoFabricate: t("automation.optimize_constraint_no_fabricate"),
    constraintConfirmRisk: t("automation.optimize_constraint_confirm_risk"),
  });
}
