import type {
  AutomationEffectiveRange,
  AutomationSchedule,
} from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";

export function nextRunAt(
  schedule: AutomationSchedule,
  from = Date.now(),
  effectiveRange: AutomationEffectiveRange = {},
): number | null {
  const [hour, minute] = parseTime(schedule.time);
  const startAt = effectiveDateStartAt(effectiveRange.startDate);
  const endAt = effectiveDateEndAt(effectiveRange.endDate);
  const base = startAt != null && from < startAt ? startAt : from;
  if (endAt != null && base > endAt) return null;
  if (schedule.mode === "interval") {
    const intervalMinutes = schedule.intervalMinutes ?? 60;
    const intervalMs = intervalMinutes * 60 * 1000;
    let intervalNext = base + intervalMs;
    const weekdays = schedule.weekdays ?? [];
    const possibleWeeklyOccurrences = 10_080 / greatestCommonDivisor(intervalMinutes, 10_080);
    let checkedOccurrences = 0;
    while (
      weekdays.length > 0 &&
      !weekdays.includes(normalizedWeekday(intervalNext)) &&
      checkedOccurrences < possibleWeeklyOccurrences
    ) {
      intervalNext += intervalMs;
      checkedOccurrences += 1;
    }
    if (
      weekdays.length > 0 &&
      !weekdays.includes(normalizedWeekday(intervalNext))
    ) return null;
    return endAt != null && intervalNext > endAt ? null : intervalNext;
  }
  if (schedule.mode === "once" && schedule.onceAt != null) {
    if (schedule.onceAt <= from) return null;
    if (startAt != null && schedule.onceAt < startAt) return null;
    return endAt != null && schedule.onceAt > endAt ? null : schedule.onceAt;
  }

  const next = nextCycleOccurrence(schedule.day, base, hour, minute);
  const timestamp = next.getTime();
  if (schedule.mode === "once") {
    return endAt != null && timestamp > endAt ? null : timestamp;
  }
  return endAt != null && timestamp > endAt ? null : timestamp;
}

export function parseTime(value: string): [number, number] {
  const parsed = parseAutomationScheduleTime(value);
  if (!parsed) {
    throw new ApiError(400, "invalid_automation_schedule", "Automation schedule time must be HH:mm");
  }
  return parsed;
}

export function parseAutomationScheduleTime(value: string): [number, number] | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return [hour, minute];
}

export function effectiveDateStartAt(value?: string): number | null {
  if (!value) return null;
  const parsed = parseEffectiveDate(value);
  if (!parsed) return null;
  const [year, month, day] = parsed;
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

export function effectiveDateEndAt(value?: string): number | null {
  if (!value) return null;
  const parsed = parseEffectiveDate(value);
  if (!parsed) return null;
  const [year, month, day] = parsed;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

export function parseEffectiveDate(value: string): [number, number, number] | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

export function compactEffectiveRange(
  startDate: string | undefined,
  endDate: string | undefined,
): AutomationEffectiveRange {
  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

function nextCycleOccurrence(
  cycle: AutomationSchedule["day"],
  base: number,
  hour: number,
  minute: number,
) {
  const candidate = new Date(base);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() > base) return candidate;

  if (cycle === "daily") {
    candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }
  if (cycle === "weekly" || cycle === "biweekly") {
    candidate.setDate(candidate.getDate() + (cycle === "weekly" ? 7 : 14));
    return candidate;
  }
  if (cycle === "monthly") {
    const targetDay = candidate.getDate();
    candidate.setDate(1);
    candidate.setMonth(candidate.getMonth() + 1);
    candidate.setDate(Math.min(targetDay, daysInMonth(candidate.getFullYear(), candidate.getMonth())));
    return candidate;
  }

  const targetMonth = candidate.getMonth();
  const targetDay = candidate.getDate();
  candidate.setDate(1);
  candidate.setFullYear(candidate.getFullYear() + 1);
  candidate.setMonth(targetMonth);
  candidate.setDate(Math.min(targetDay, daysInMonth(candidate.getFullYear(), targetMonth)));
  return candidate;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function normalizedWeekday(timestamp: number): number {
  const day = new Date(timestamp).getDay();
  return day === 0 ? 7 : day;
}
