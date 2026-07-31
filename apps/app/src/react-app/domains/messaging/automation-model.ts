import {
  AlarmClock,
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  Languages,
  Newspaper,
  Presentation,
  Receipt,
  Route,
  Truck,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";

/** Automations are office-only (code scene/templates removed). */
export type AutomationScene = "office";
export type AutomationTemplateCategory = AutomationScene | "shared";
export type AutomationFrequencyMode = "weekly" | "interval" | "once";
export type AutomationCycle = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";

export type AutomationDefaultSchedule = {
  mode: AutomationFrequencyMode;
  day: AutomationCycle;
  time: string;
};

export type AutomationTemplate = {
  id: string;
  category: AutomationTemplateCategory;
  titleKey: string;
  descriptionKey: string;
  promptKey: string;
  icon: ComponentType<{ className?: string }>;
  defaultSchedule: AutomationDefaultSchedule;
  /** L2 vertical ids for personalization ranking (empty = generic/shared). */
  verticalIds?: string[];
  roleTags?: string[];
  taskTags?: string[];
};

const defaultDailySchedule: AutomationDefaultSchedule = {
  mode: "weekly",
  day: "daily",
  time: "09:00",
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  // —— 物流（office）——
  {
    id: "logistics-dispatch-brief",
    category: "office",
    titleKey: "automation.template_logistics_dispatch_brief_title",
    descriptionKey: "automation.template_logistics_dispatch_brief_desc",
    promptKey: "automation.template_logistics_dispatch_brief_prompt",
    icon: Truck,
    defaultSchedule: { ...defaultDailySchedule, time: "08:00" },
    verticalIds: ["logistics-supply", "manufacturing-ops"],
    roleTags: ["operations", "logistics-ops", "management"],
    taskTags: ["dispatch", "daily-brief"],
  },
  {
    id: "logistics-exception-followup",
    category: "office",
    titleKey: "automation.template_logistics_exception_followup_title",
    descriptionKey: "automation.template_logistics_exception_followup_desc",
    promptKey: "automation.template_logistics_exception_followup_prompt",
    icon: AlertTriangle,
    defaultSchedule: { ...defaultDailySchedule, time: "10:00" },
    verticalIds: ["logistics-supply", "manufacturing-ops"],
    roleTags: ["operations", "logistics-ops"],
    taskTags: ["dispatch", "customer-communication"],
  },
  {
    id: "logistics-in-transit-risk",
    category: "office",
    titleKey: "automation.template_logistics_in_transit_risk_title",
    descriptionKey: "automation.template_logistics_in_transit_risk_desc",
    promptKey: "automation.template_logistics_in_transit_risk_prompt",
    icon: Route,
    defaultSchedule: { ...defaultDailySchedule, time: "14:00" },
    verticalIds: ["logistics-supply"],
    roleTags: ["operations", "logistics-ops"],
    taskTags: ["dispatch", "data-analysis"],
  },
  {
    id: "logistics-weekly-ops-report",
    category: "office",
    titleKey: "automation.template_logistics_weekly_ops_report_title",
    descriptionKey: "automation.template_logistics_weekly_ops_report_desc",
    promptKey: "automation.template_logistics_weekly_ops_report_prompt",
    icon: ClipboardList,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "17:30",
    },
    verticalIds: ["logistics-supply", "manufacturing-ops"],
    roleTags: ["operations", "management"],
    taskTags: ["weekly-report", "data-analysis"],
  },
  {
    id: "logistics-pod-chase",
    category: "office",
    titleKey: "automation.template_logistics_pod_chase_title",
    descriptionKey: "automation.template_logistics_pod_chase_desc",
    promptKey: "automation.template_logistics_pod_chase_prompt",
    icon: Receipt,
    defaultSchedule: { ...defaultDailySchedule, time: "16:00" },
    verticalIds: ["logistics-supply"],
    roleTags: ["operations", "finance", "sales"],
    taskTags: ["customer-communication", "recon"],
  },
  {
    id: "logistics-recon-reminder",
    category: "office",
    titleKey: "automation.template_logistics_recon_reminder_title",
    descriptionKey: "automation.template_logistics_recon_reminder_desc",
    promptKey: "automation.template_logistics_recon_reminder_prompt",
    icon: Wallet,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "09:30",
    },
    verticalIds: ["logistics-supply", "finance-pro", "ecommerce-retail"],
    roleTags: ["finance", "operations"],
    taskTags: ["recon", "data-analysis"],
  },
  // —— 通用（office）——
  {
    id: "daily-ai-news",
    category: "office",
    titleKey: "automation.template_daily_ai_news_title",
    descriptionKey: "automation.template_daily_ai_news_desc",
    promptKey: "automation.template_daily_ai_news_prompt",
    icon: Newspaper,
    defaultSchedule: defaultDailySchedule,
    verticalIds: [],
    taskTags: ["daily-brief"],
  },
  {
    id: "daily-english-words",
    category: "office",
    titleKey: "automation.template_daily_english_words_title",
    descriptionKey: "automation.template_daily_english_words_desc",
    promptKey: "automation.template_daily_english_words_prompt",
    icon: Languages,
    defaultSchedule: defaultDailySchedule,
    verticalIds: ["education"],
    taskTags: ["study-plan"],
  },
  {
    id: "weekly-work-report",
    category: "office",
    titleKey: "automation.template_weekly_work_report_title",
    descriptionKey: "automation.template_weekly_work_report_desc",
    promptKey: "automation.template_weekly_work_report_prompt",
    icon: ClipboardList,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "17:00",
    },
    verticalIds: [],
    taskTags: ["weekly-report"],
  },
  {
    id: "meeting-prep",
    category: "office",
    titleKey: "automation.template_meeting_prep_title",
    descriptionKey: "automation.template_meeting_prep_desc",
    promptKey: "automation.template_meeting_prep_prompt",
    icon: Presentation,
    defaultSchedule: { ...defaultDailySchedule, time: "09:30" },
    verticalIds: [],
    taskTags: ["meeting-notes"],
  },
  {
    id: "today-in-history",
    category: "office",
    titleKey: "automation.template_today_history_title",
    descriptionKey: "automation.template_today_history_desc",
    promptKey: "automation.template_today_history_prompt",
    icon: CalendarDays,
    defaultSchedule: defaultDailySchedule,
    verticalIds: ["education"],
    taskTags: ["study-plan"],
  },
  {
    id: "parent-contact-reminder",
    category: "office",
    titleKey: "automation.template_parent_contact_title",
    descriptionKey: "automation.template_parent_contact_desc",
    promptKey: "automation.template_parent_contact_prompt",
    icon: AlarmClock,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "10:00",
    },
    verticalIds: [],
    taskTags: [],
  },
];

/** Logistics template ids used by personalization plans. */
export const LOGISTICS_AUTOMATION_TEMPLATE_IDS = [
  "logistics-dispatch-brief",
  "logistics-exception-followup",
  "logistics-in-transit-risk",
  "logistics-weekly-ops-report",
  "logistics-pod-chase",
  "logistics-recon-reminder",
] as const;

export function getAutomationTemplatesForScene(scene: AutomationScene): AutomationTemplate[] {
  return AUTOMATION_TEMPLATES.filter((template) => template.category === "shared" || template.category === scene);
}

export function isAutomationScheduleTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
