import {
  BarChart3,
  Coffee,
  FileText,
  Grid2X2,
  LineChart,
  Monitor,
  Search,
} from "lucide-react";
import type { ComponentType } from "react";
import { t } from "../../../../i18n";

/** Personal-assistant home is office-only (code track removed). */
export type AssistantCategoryId = "office";

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
/** Full-bleed circular brand avatar (no nested squircle frame). */
export const ONMYAGENT_ASSISTANT_AVATAR = "/onmyagent-assistant-avatar.png";

export const PERSONAL_ASSISTANT_CATEGORIES: AssistantCategory[] = [
  {
    id: "office",
    get label() {
      return t("assistant.category_office");
    },
    icon: Coffee,
    scenarios: [
      {
        id: "slides",
        get label() {
          return t("assistant.scenario_slides");
        },
        icon: Monitor,
        get prompts() {
          return [t("assistant.prompt_slides_1"), t("assistant.prompt_slides_2")];
        },
      },
      {
        id: "deep-research",
        get label() {
          return t("assistant.scenario_deep_research");
        },
        icon: Search,
        get prompts() {
          return [
            t("assistant.prompt_deep_research_1"),
            t("assistant.prompt_deep_research_2"),
          ];
        },
      },
      {
        id: "documents",
        get label() {
          return t("assistant.scenario_documents");
        },
        icon: FileText,
        get prompts() {
          return [
            t("assistant.prompt_documents_1"),
            t("assistant.prompt_documents_2"),
          ];
        },
      },
      {
        id: "data-analysis",
        get label() {
          return t("assistant.scenario_data_analysis");
        },
        icon: BarChart3,
        get prompts() {
          return [
            t("assistant.prompt_data_analysis_1"),
            t("assistant.prompt_data_analysis_2"),
          ];
        },
      },
      {
        id: "data-viz",
        get label() {
          return t("assistant.scenario_data_viz");
        },
        icon: Grid2X2,
        get prompts() {
          return [
            t("assistant.prompt_data_viz_1"),
            t("assistant.prompt_data_viz_2"),
          ];
        },
      },
      {
        id: "finance",
        get label() {
          return t("assistant.scenario_finance");
        },
        icon: LineChart,
        get prompts() {
          return [
            t("assistant.prompt_finance_1"),
            t("assistant.prompt_finance_2"),
          ];
        },
      },
    ],
  },
];
