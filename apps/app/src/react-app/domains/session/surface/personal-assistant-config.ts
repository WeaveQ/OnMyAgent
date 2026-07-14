import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Bug,
  Code2,
  Coffee,
  FileText,
  Folder,
  Globe,
  Grid2X2,
  LineChart,
  Monitor,
  Palette,
  Presentation,
  Search,
  Smartphone,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";
import { t } from "../../../../i18n";

export type AssistantCategoryId = "code" | "office";

export type AssistantScenario = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  prompts: string[];
};

export type AssistantCategory = {
  id: AssistantCategoryId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  scenarios: AssistantScenario[];
};

export function onmyagentAssistantName() {
  return t("assistant.name");
}
export const ONMYAGENT_ASSISTANT_AVATAR = "/on-my-agent-logo.png";

export const PERSONAL_ASSISTANT_CATEGORIES: AssistantCategory[] = [
  {
    id: "code",
    get label() { return t("assistant.category_code"); },
    icon: Code2,
    scenarios: [
      {
        id: "daily-dev",
        get label() { return t("assistant.scenario_daily_dev"); },
        icon: Code2,
        get prompts() { return [
          t("assistant.prompt_daily_dev_1"),
          t("assistant.prompt_daily_dev_2"),
          t("assistant.prompt_daily_dev_3"),
          t("assistant.prompt_daily_dev_4"),
          t("assistant.prompt_daily_dev_5"),
          t("assistant.prompt_daily_dev_6"),
        ]; },
      },
      {
        id: "website-dev",
        get label() { return t("assistant.scenario_website_dev"); },
        icon: Globe,
        get prompts() { return [
          t("assistant.prompt_website_dev_1"),
          t("assistant.prompt_website_dev_2"),
          t("assistant.prompt_website_dev_3"),
        ]; },
      },
      {
        id: "agent-app",
        get label() { return t("assistant.scenario_agent_app"); },
        icon: Sparkles,
        get prompts() { return [
          t("assistant.prompt_agent_app_1"),
          t("assistant.prompt_agent_app_2"),
        ]; },
      },
      {
        id: "skill-dev",
        get label() { return t("assistant.scenario_skill_dev"); },
        icon: Wrench,
        get prompts() { return [
          t("assistant.prompt_skill_dev_1"),
          t("assistant.prompt_skill_dev_2"),
        ]; },
      },
      {
        id: "ci-cd",
        label: "CI/CD",
        icon: Bug,
        get prompts() { return [
          t("assistant.prompt_ci_cd_1"),
          t("assistant.prompt_ci_cd_2"),
        ]; },
      },
      {
        id: "docs",
        get label() { return t("assistant.scenario_docs"); },
        icon: BookOpen,
        get prompts() { return [
          t("assistant.prompt_docs_1"),
          t("assistant.prompt_docs_2"),
        ]; },
      },
    ],
  },
  {
    id: "office",
    get label() { return t("assistant.category_office"); },
    icon: Coffee,
    scenarios: [
      {
        id: "slides",
        get label() { return t("assistant.scenario_slides"); },
        icon: Monitor,
        get prompts() { return [
          t("assistant.prompt_slides_1"),
          t("assistant.prompt_slides_2"),
        ]; },
      },
      {
        id: "deep-research",
        get label() { return t("assistant.scenario_deep_research"); },
        icon: Search,
        get prompts() { return [
          t("assistant.prompt_deep_research_1"),
          t("assistant.prompt_deep_research_2"),
        ]; },
      },
      {
        id: "documents",
        get label() { return t("assistant.scenario_documents"); },
        icon: FileText,
        get prompts() { return [
          t("assistant.prompt_documents_1"),
          t("assistant.prompt_documents_2"),
        ]; },
      },
      {
        id: "data-analysis",
        get label() { return t("assistant.scenario_data_analysis"); },
        icon: BarChart3,
        get prompts() { return [
          t("assistant.prompt_data_analysis_1"),
          t("assistant.prompt_data_analysis_2"),
        ]; },
      },
      {
        id: "data-viz",
        get label() { return t("assistant.scenario_data_viz"); },
        icon: Grid2X2,
        get prompts() { return [
          t("assistant.prompt_data_viz_1"),
          t("assistant.prompt_data_viz_2"),
        ]; },
      },
      {
        id: "finance",
        get label() { return t("assistant.scenario_finance"); },
        icon: LineChart,
        get prompts() { return [
          t("assistant.prompt_finance_1"),
          t("assistant.prompt_finance_2"),
        ]; },
      },
    ],
  },
];
