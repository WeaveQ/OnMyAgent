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
        prompts: [
          "帮我给当前项目添加一个新功能：【功能描述】。",
          "帮我重构这段代码，提升可读性和可维护性。",
          "帮我修复这个 Bug：【Bug 描述】。",
          "帮我优化这个功能的性能，当前问题是【性能问题描述】。",
          "帮我给这个模块添加单元测试，覆盖核心逻辑。",
          "帮我排查这个报错：【错误信息】，找出原因并修复。",
        ],
      },
      {
        id: "website-dev",
        get label() { return t("assistant.scenario_website_dev"); },
        icon: Globe,
        prompts: [
          "帮我搭建一个响应式网站页面，主题是【页面主题】。",
          "帮我优化这个页面的移动端布局。",
          "帮我把这个页面做得更专业、更适合非技术用户。",
        ],
      },
      {
        id: "agent-app",
        get label() { return t("assistant.scenario_agent_app"); },
        icon: Sparkles,
        prompts: [
          "帮我设计一个 Agent 工作流，用来处理【任务场景】。",
          "帮我为这个 Agent 补充系统提示词和工具调用策略。",
        ],
      },
      {
        id: "skill-dev",
        get label() { return t("assistant.scenario_skill_dev"); },
        icon: Wrench,
        prompts: [
          "帮我创建一个 Codex skill，用于【能力描述】。",
          "帮我检查这个 skill 的触发条件和工作流是否清晰。",
        ],
      },
      {
        id: "ci-cd",
        label: "CI/CD",
        icon: Bug,
        prompts: [
          "帮我为这个项目补充 CI 检查流程。",
          "帮我排查 CI 失败原因，并给出最小修复方案。",
        ],
      },
      {
        id: "docs",
        get label() { return t("assistant.scenario_docs"); },
        icon: BookOpen,
        prompts: [
          "帮我为这个功能写一份使用文档。",
          "帮我把这段技术说明改写成更容易理解的版本。",
        ],
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
        prompts: [
          "帮我生成一份关于【主题】的 PPT 大纲。",
          "帮我把这段内容整理成适合汇报的幻灯片结构。",
        ],
      },
      {
        id: "deep-research",
        get label() { return t("assistant.scenario_deep_research"); },
        icon: Search,
        prompts: [
          "帮我围绕【研究主题】做一份结构化研究报告。",
          "帮我比较【对象 A】和【对象 B】的优劣势。",
        ],
      },
      {
        id: "documents",
        get label() { return t("assistant.scenario_documents"); },
        icon: FileText,
        prompts: [
          "帮我润色这份文档，让表达更正式清晰。",
          "帮我把这份材料整理成会议纪要。",
        ],
      },
      {
        id: "data-analysis",
        get label() { return t("assistant.scenario_data_analysis"); },
        icon: BarChart3,
        prompts: [
          "帮我分析这份数据，找出关键趋势和异常点。",
          "帮我根据这些数据生成一份业务洞察摘要。",
        ],
      },
      {
        id: "data-viz",
        get label() { return t("assistant.scenario_data_viz"); },
        icon: Grid2X2,
        prompts: [
          "帮我把这份数据做成可视化图表，并解释结论。",
          "帮我设计一个数据看板，展示【核心指标】。",
        ],
      },
      {
        id: "finance",
        get label() { return t("assistant.scenario_finance"); },
        icon: LineChart,
        prompts: [
          "帮我整理一份【行业/公司】的财务分析框架。",
          "帮我解释这份财报里的关键指标变化。",
        ],
      },
    ],
  },
];
