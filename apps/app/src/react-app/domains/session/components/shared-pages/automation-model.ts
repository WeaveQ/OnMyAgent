import {
  AlarmClock,
  Bug,
  CalendarDays,
  ClipboardList,
  FileCode,
  Film,
  GitPullRequest,
  HeartPulse,
  HelpCircle,
  Image,
  Languages,
  ListChecks,
  Moon,
  Newspaper,
  PackageCheck,
  PhoneCall,
  Presentation,
  ScrollText,
  ShieldCheck,
  Tags,
} from "lucide-react";
import type { ComponentType } from "react";

export type AutomationScene = "office" | "code";
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
};

const defaultDailySchedule: AutomationDefaultSchedule = {
  mode: "weekly",
  day: "daily",
  time: "09:00",
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "daily-ai-news",
    category: "office",
    titleKey: "automation.template_daily_ai_news_title",
    descriptionKey: "automation.template_daily_ai_news_desc",
    promptKey: "automation.template_daily_ai_news_prompt",
    icon: Newspaper,
    defaultSchedule: defaultDailySchedule,
  },
  {
    id: "daily-english-words",
    category: "office",
    titleKey: "automation.template_daily_english_words_title",
    descriptionKey: "automation.template_daily_english_words_desc",
    promptKey: "automation.template_daily_english_words_prompt",
    icon: Languages,
    defaultSchedule: defaultDailySchedule,
  },
  {
    id: "daily-bedtime-story",
    category: "office",
    titleKey: "automation.template_daily_bedtime_story_title",
    descriptionKey: "automation.template_daily_bedtime_story_desc",
    promptKey: "automation.template_daily_bedtime_story_prompt",
    icon: Moon,
    defaultSchedule: { ...defaultDailySchedule, time: "20:30" },
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
      time: "17:30",
    },
  },
  {
    id: "classic-movie-recommendation",
    category: "office",
    titleKey: "automation.template_classic_movie_title",
    descriptionKey: "automation.template_classic_movie_desc",
    promptKey: "automation.template_classic_movie_prompt",
    icon: Film,
    defaultSchedule: defaultDailySchedule,
  },
  {
    id: "today-in-history",
    category: "office",
    titleKey: "automation.template_today_history_title",
    descriptionKey: "automation.template_today_history_desc",
    promptKey: "automation.template_today_history_prompt",
    icon: CalendarDays,
    defaultSchedule: defaultDailySchedule,
  },
  {
    id: "daily-why",
    category: "office",
    titleKey: "automation.template_daily_why_title",
    descriptionKey: "automation.template_daily_why_desc",
    promptKey: "automation.template_daily_why_prompt",
    icon: HelpCircle,
    defaultSchedule: defaultDailySchedule,
  },
  {
    id: "parent-contact-reminder",
    category: "office",
    titleKey: "automation.template_parent_contact_title",
    descriptionKey: "automation.template_parent_contact_desc",
    promptKey: "automation.template_parent_contact_prompt",
    icon: AlarmClock,
    defaultSchedule: { ...defaultDailySchedule, time: "10:00" },
  },
  {
    id: "health-check-reminder",
    category: "office",
    titleKey: "automation.template_health_check_title",
    descriptionKey: "automation.template_health_check_desc",
    promptKey: "automation.template_health_check_prompt",
    icon: HeartPulse,
    defaultSchedule: { ...defaultDailySchedule, time: "07:00" },
  },
  {
    id: "interview-prep-reminder",
    category: "office",
    titleKey: "automation.template_interview_prep_title",
    descriptionKey: "automation.template_interview_prep_desc",
    promptKey: "automation.template_interview_prep_prompt",
    icon: PhoneCall,
    defaultSchedule: { ...defaultDailySchedule, time: "09:00" },
  },
  {
    id: "meeting-prep",
    category: "office",
    titleKey: "automation.template_meeting_prep_title",
    descriptionKey: "automation.template_meeting_prep_desc",
    promptKey: "automation.template_meeting_prep_prompt",
    icon: Presentation,
    defaultSchedule: { ...defaultDailySchedule, time: "09:30" },
  },
  {
    id: "cute-pet-wallpaper",
    category: "office",
    titleKey: "automation.template_pet_wallpaper_title",
    descriptionKey: "automation.template_pet_wallpaper_desc",
    promptKey: "automation.template_pet_wallpaper_prompt",
    icon: Image,
    defaultSchedule: defaultDailySchedule,
  },
  {
    id: "code-daily-review",
    category: "code",
    titleKey: "automation.template_code_daily_review_title",
    descriptionKey: "automation.template_code_daily_review_desc",
    promptKey: "automation.template_code_daily_review_prompt",
    icon: GitPullRequest,
    defaultSchedule: { ...defaultDailySchedule, time: "18:00" },
  },
  {
    id: "code-ci-followup",
    category: "code",
    titleKey: "automation.template_code_ci_followup_title",
    descriptionKey: "automation.template_code_ci_followup_desc",
    promptKey: "automation.template_code_ci_followup_prompt",
    icon: ListChecks,
    defaultSchedule: { ...defaultDailySchedule, time: "10:00" },
  },
  {
    id: "code-dependency-health",
    category: "code",
    titleKey: "automation.template_code_dependency_health_title",
    descriptionKey: "automation.template_code_dependency_health_desc",
    promptKey: "automation.template_code_dependency_health_prompt",
    icon: PackageCheck,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "10:30",
    },
  },
  {
    id: "code-security-check",
    category: "code",
    titleKey: "automation.template_code_security_check_title",
    descriptionKey: "automation.template_code_security_check_desc",
    promptKey: "automation.template_code_security_check_prompt",
    icon: ShieldCheck,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "11:00",
    },
  },
  {
    id: "code-todo-cleanup",
    category: "code",
    titleKey: "automation.template_code_todo_cleanup_title",
    descriptionKey: "automation.template_code_todo_cleanup_desc",
    promptKey: "automation.template_code_todo_cleanup_prompt",
    icon: Bug,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "16:00",
    },
  },
  {
    id: "code-docs-sync",
    category: "code",
    titleKey: "automation.template_code_docs_sync_title",
    descriptionKey: "automation.template_code_docs_sync_desc",
    promptKey: "automation.template_code_docs_sync_prompt",
    icon: ScrollText,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "16:30",
    },
  },
  {
    id: "code-release-notes",
    category: "code",
    titleKey: "automation.template_code_release_notes_title",
    descriptionKey: "automation.template_code_release_notes_desc",
    promptKey: "automation.template_code_release_notes_prompt",
    icon: Tags,
    defaultSchedule: {
      mode: "weekly",
      day: "weekly",
      time: "17:00",
    },
  },
  {
    id: "code-file-change-summary",
    category: "code",
    titleKey: "automation.template_code_file_change_summary_title",
    descriptionKey: "automation.template_code_file_change_summary_desc",
    promptKey: "automation.template_code_file_change_summary_prompt",
    icon: FileCode,
    defaultSchedule: defaultDailySchedule,
  },
];

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
