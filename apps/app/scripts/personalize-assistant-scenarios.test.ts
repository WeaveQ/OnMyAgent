import { describe, expect, test } from "bun:test";
import { BarChart3, FileText, LineChart, Monitor } from "lucide-react";

import {
  personalizeAssistantScenarios,
  personalizeAssistantScenariosForMenu,
  personalizePromptText,
  PROMPT_TEMPLATE_MENU_LIMIT,
} from "../src/react-app/domains/session/surface/personalize-assistant-scenarios";

const scenarios = [
  {
    id: "slides",
    label: "Slides",
    icon: Monitor,
    prompts: ["帮我生成一份关于【主题】的 PPT 大纲。"],
  },
  {
    id: "documents",
    label: "Documents",
    icon: FileText,
    prompts: ["帮我润色这份文档。"],
  },
  {
    id: "data-analysis",
    label: "Data",
    icon: BarChart3,
    prompts: ["帮我分析这份数据。"],
  },
  {
    id: "finance",
    label: "Finance",
    icon: LineChart,
    prompts: ["帮我整理【行业/公司】财务框架。"],
  },
];

describe("personalizeAssistantScenarios", () => {
  test("keeps catalog order when profile is empty", () => {
    const ranked = personalizeAssistantScenarios(scenarios, null);
    expect(ranked.map((row) => row.id)).toEqual([
      "slides",
      "documents",
      "data-analysis",
      "finance",
    ]);
    expect(ranked.every((row) => !row.recommended)).toBe(true);
  });

  test("ranks finance and data higher for finance + data-analysis profile", () => {
    const ranked = personalizeAssistantScenarios(scenarios, {
      roles: ["finance"],
      industries: ["finance"],
      tasks: ["data-analysis", "recon"],
      tools: ["excel"],
      docPreference: "data",
    });
    // data-analysis matches task + role + tool + docPreference; finance matches industry/role/task.
    expect(ranked.map((row) => row.id).slice(0, 2).sort()).toEqual([
      "data-analysis",
      "finance",
    ]);
    expect(ranked[0]?.recommended).toBe(true);
    expect(ranked.some((row) => row.id === "finance" && row.score > 0)).toBe(
      true,
    );
  });

  test("personalizePromptText grounds generic placeholders", () => {
    const text = personalizePromptText(
      "帮我生成一份关于【主题】的 PPT 大纲。",
      { industries: ["ecommerce"] },
    );
    expect(text).toContain("相关主题");
    expect(text).not.toContain("【主题】");
  });

  test("menu helper keeps a short preference-ranked list", () => {
    const longCatalog = [
      ...scenarios,
      {
        id: "data-viz",
        label: "Viz",
        icon: BarChart3,
        prompts: ["帮我把数据可视化。"],
      },
      {
        id: "deep-research",
        label: "Research",
        icon: FileText,
        prompts: ["帮我做研究。"],
      },
    ];
    expect(longCatalog.length).toBeGreaterThan(PROMPT_TEMPLATE_MENU_LIMIT);

    const emptyProfile = personalizeAssistantScenariosForMenu(longCatalog, null);
    expect(emptyProfile).toHaveLength(PROMPT_TEMPLATE_MENU_LIMIT);
    expect(emptyProfile.map((row) => row.id)).toEqual(
      longCatalog.slice(0, PROMPT_TEMPLATE_MENU_LIMIT).map((row) => row.id),
    );

    const financeMenu = personalizeAssistantScenariosForMenu(longCatalog, {
      roles: ["finance"],
      industries: ["finance"],
      tasks: ["data-analysis", "recon"],
      tools: ["excel"],
      docPreference: "data",
    });
    expect(financeMenu).toHaveLength(PROMPT_TEMPLATE_MENU_LIMIT);
    expect(financeMenu.map((row) => row.id)).toContain("finance");
    expect(financeMenu.map((row) => row.id)).toContain("data-analysis");
  });
});
