/** @jsxImportSource react */
import {
  Sparkles,
  FileText,
  Code,
  Lightbulb,
  Target,
  ClipboardList,
  PenLine,
  MessageSquare,
} from "lucide-react";
import type { ComponentType } from "react";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type PromptSuggestion = {
  title: string;
  description?: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
};

type PromptTemplates = Record<string, PromptSuggestion[]>;

const GENERIC_PROMPTS: PromptSuggestion[] = [
  {
    title: "分析问题",
    description: "给我一份结构化的分析",
    prompt: "请帮我分析以下内容，并给出结构化的要点总结：\n",
    icon: Lightbulb,
  },
  {
    title: "起草文档",
    description: "生成一份专业文档",
    prompt:
      "请帮我起草一份关于 ____ 的文档，包含背景、目标、方案和下一步计划。",
    icon: PenLine,
  },
  {
    title: "头脑风暴",
    description: "发散多个创意方向",
    prompt:
      "请针对 ____ 话题进行头脑风暴，给出至少 5 个不同的创意方向，每个方向都简述理由。",
    icon: Sparkles,
  },
  {
    title: "总结归纳",
    description: "提炼核心观点",
    prompt: "请帮我把下面的内容总结成 3-5 个核心要点，尽量简洁明了：\n",
    icon: FileText,
  },
];

const TEMPLATE_PROMPTS: PromptTemplates = {
  "blank-agent": GENERIC_PROMPTS,
  "daily-assistant": [
    {
      title: "日程整理",
      description: "帮我梳理今天的待办",
      prompt:
        "请帮我整理今天的待办事项，按优先级从高到低列出，并给出时间建议：\n",
      icon: ClipboardList,
    },
    {
      title: "写作辅助",
      description: "润色我的文字",
      prompt: "请帮我润色以下文字，让表达更清晰、更专业：\n",
      icon: PenLine,
    },
    {
      title: "快速总结",
      description: "提炼一篇长文的核心",
      prompt: "请把下面这段长内容总结成 5 个核心要点，每个要点不超过一句话：\n",
      icon: FileText,
    },
    {
      title: "计划建议",
      description: "做一份行动计划",
      prompt:
        "我想实现 ____（目标），请帮我制定一份行动计划，包含具体步骤、预估时间和可能遇到的风险。",
      icon: Target,
    },
  ],
  "pixel-retail": [
    {
      title: "商品描述",
      description: "写出吸引人的卖点文案",
      prompt:
        "请为以下商品写一段吸引人的商品描述，突出核心卖点和差异化优势：\n商品名称：\n目标受众：",
      icon: PenLine,
    },
    {
      title: "竞品分析",
      description: "对比同类商品",
      prompt:
        "请帮我做一个竞品分析，对比我的商品与 3 个主要竞品的价格、功能、评价、售后等维度：\n我的商品：",
      icon: Target,
    },
    {
      title: "客服话术",
      description: "生成标准回复",
      prompt:
        "请帮我生成客服话术模板，针对以下常见客户问题：\n1. 商品质量问题\n2. 物流延迟\n3. 退换货申请\n",
      icon: MessageSquare,
    },
    {
      title: "营销方案",
      description: "设计促销活动",
      prompt:
        "请为我的电商店铺设计一个促销活动方案，包含活动主题、优惠规则、推广渠道和预算分配。我的店铺主营 ____。",
      icon: Sparkles,
    },
  ],
};

const EXPERT_PROMPT_ICONS = [Sparkles, FileText, Target];

const CODE_PROMPTS: PromptSuggestion[] = [
  {
    title: "代码审查",
    description: "找问题、给建议",
    prompt:
      "请帮我审查以下代码，指出潜在的问题、安全隐患或可优化的地方，并给出改进建议：\n",
    icon: Code,
  },
  {
    title: "实现功能",
    description: "从零开始编写",
    prompt:
      "请帮我实现 ____ 功能，使用 ____ 技术栈，包含单元测试和边界情况处理。",
    icon: Code,
  },
  {
    title: "调试问题",
    description: "定位并修复 bug",
    prompt:
      "我遇到了以下问题：____。请帮我分析可能的原因并给出修复方案。相关代码和错误信息如下：\n",
    icon: Lightbulb,
  },
  {
    title: "重构代码",
    description: "提升代码质量",
    prompt:
      "请把以下代码重构为更简洁、可维护的版本，保持良好的函数拆分和类型安全：\n",
    icon: Sparkles,
  },
];

TEMPLATE_PROMPTS["pixel-tech"] = CODE_PROMPTS;

// 业务专家、设计专家、电商专家等 — 按 agent ID 映射
const DOMAIN_EXPERT_PROMPTS: PromptSuggestion[] = [
  {
    title: "业务分析",
    description: "从业务角度解读需求",
    prompt: "请从业务角度分析以下需求，包括可行性、预期收益和实施路径：\n",
    icon: Target,
  },
  {
    title: "方案起草",
    description: "输出一份业务方案",
    prompt:
      "请起草一份业务方案，背景是 ____，目标是 ____。包含现状、问题、解决方案和预期效果。",
    icon: FileText,
  },
  {
    title: "数据解读",
    description: "从数据中提炼洞察",
    prompt: "请解读以下业务数据，提炼趋势、异常点和潜在机会：\n",
    icon: Lightbulb,
  },
  {
    title: "竞品调研",
    description: "梳理对标方案",
    prompt:
      "请针对 ____ 领域做一份竞品调研，列出 3-5 个主要竞品的核心功能、定价策略和差异化优势。",
    icon: ClipboardList,
  },
];

for (const id of ["pixel-business", "pixel-product"]) {
  TEMPLATE_PROMPTS[id] = DOMAIN_EXPERT_PROMPTS;
}

function resolvePrompts(
  agentId: string | null | undefined,
): PromptSuggestion[] {
  if (agentId && agentId in TEMPLATE_PROMPTS) {
    return TEMPLATE_PROMPTS[agentId];
  }
  // Fallback: 包含 "tech" -> 代码；包含 "business" / "product" / "retail" -> 业务
  if (agentId) {
    if (agentId.includes("tech") || agentId.includes("code"))
      return CODE_PROMPTS;
    if (
      agentId.includes("business") ||
      agentId.includes("product") ||
      agentId.includes("retail")
    ) {
      return DOMAIN_EXPERT_PROMPTS;
    }
  }
  return GENERIC_PROMPTS;
}

function promptsFromExpertQuickPrompts(quickPrompts: string[] | undefined): PromptSuggestion[] | null {
  const prompts = (quickPrompts ?? [])
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (prompts.length === 0) return null;
  return [
    {
      title: t("session.expert_self_intro_prompt_title"),
      description: t("session.expert_self_intro_prompt"),
      prompt: t("session.expert_self_intro_prompt"),
      icon: MessageSquare,
    },
    ...prompts.map((prompt, index) => ({
      title: prompt,
      prompt,
      icon: EXPERT_PROMPT_ICONS[index] ?? Sparkles,
    })),
  ];
}

export function AgentPromptSuggestions(props: {
  agentId: string | null | undefined;
  quickPrompts?: string[];
  onSelect: (prompt: string) => void;
  className?: string;
}) {
  const prompts =
    promptsFromExpertQuickPrompts(props.quickPrompts) ??
    resolvePrompts(props.agentId).slice(0, 4);
  return (
    <div className={cn("w-full max-w-[720px] pt-12", props.className)}>
      <div className="grid grid-cols-2 gap-2.5">
        {prompts.map((p) => {
          const Icon = p.icon;
          return (
            <ActionRowButton
              key={p.title}
              density="card"
              type="button"
              onClick={() => props.onSelect(p.prompt)}
              className="group relative overflow-hidden rounded-xl border-dls-mist transition-all duration-200 hover:-translate-y-0.5 hover:border-dls-border-strong"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-dls-brand-faint-blue via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="relative flex items-start gap-3">
                <IconTile className="mt-0.5 transition-colors group-hover:bg-dls-hover group-hover:text-dls-accent" shape="xl" tone="accent">
                  <Icon className="size-3.5" />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className={cn(
                    "text-sm font-medium text-dls-text",
                    p.description ? "truncate" : "line-clamp-2 leading-5",
                  )}>
                    {p.title}
                  </div>
                  {p.description ? (
                    <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-dls-secondary">
                      {p.description}
                    </div>
                  ) : null}
                </div>
              </div>
            </ActionRowButton>
          );
        })}
      </div>
    </div>
  );
}
