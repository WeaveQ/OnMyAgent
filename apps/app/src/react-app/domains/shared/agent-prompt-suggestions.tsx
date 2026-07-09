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

function getGenericPrompts(): PromptSuggestion[] {
  return [
  {
    title: t("session.prompt_generic_analyze_title"),
    description: t("session.prompt_generic_analyze_desc"),
    prompt: t("session.prompt_generic_analyze_body"),
    icon: Lightbulb,
  },
  {
    title: t("session.prompt_generic_draft_doc_title"),
    description: t("session.prompt_generic_draft_doc_desc"),
    prompt: t("session.prompt_generic_draft_doc_body"),
    icon: PenLine,
  },
  {
    title: t("session.prompt_generic_brainstorm_title"),
    description: t("session.prompt_generic_brainstorm_desc"),
    prompt: t("session.prompt_generic_brainstorm_body"),
    icon: Sparkles,
  },
  {
    title: t("session.prompt_generic_summarize_title"),
    description: t("session.prompt_generic_summarize_desc"),
    prompt: t("session.prompt_generic_summarize_body"),
    icon: FileText,
  },
  ];
}

function getDailyAssistantPrompts(): PromptSuggestion[] {
  return [
  {
    title: t("session.prompt_daily_schedule_title"),
    description: t("session.prompt_daily_schedule_desc"),
    prompt: t("session.prompt_daily_schedule_body"),
    icon: ClipboardList,
  },
  {
    title: t("session.prompt_daily_writing_polish_title"),
    description: t("session.prompt_daily_writing_polish_desc"),
    prompt: t("session.prompt_daily_writing_polish_body"),
    icon: PenLine,
  },
  {
    title: t("session.prompt_daily_quick_summary_title"),
    description: t("session.prompt_daily_quick_summary_desc"),
    prompt: t("session.prompt_daily_quick_summary_body"),
    icon: FileText,
  },
  {
    title: t("session.prompt_daily_plan_action_title"),
    description: t("session.prompt_daily_plan_action_desc"),
    prompt: t("session.prompt_daily_plan_action_body"),
    icon: Target,
  },
  ];
}

function getPixelRetailPrompts(): PromptSuggestion[] {
  return [
  {
    title: t("session.prompt_retail_product_desc_title"),
    description: t("session.prompt_retail_product_desc_desc"),
    prompt: t("session.prompt_retail_product_desc_body"),
    icon: PenLine,
  },
  {
    title: t("session.prompt_retail_competitor_analysis_title"),
    description: t("session.prompt_retail_competitor_analysis_desc"),
    prompt: t("session.prompt_retail_competitor_analysis_body"),
    icon: Target,
  },
  {
    title: t("session.prompt_retail_customer_service_title"),
    description: t("session.prompt_retail_customer_service_desc"),
    prompt: t("session.prompt_retail_customer_service_body"),
    icon: MessageSquare,
  },
  {
    title: t("session.prompt_retail_marketing_plan_title"),
    description: t("session.prompt_retail_marketing_plan_desc"),
    prompt: t("session.prompt_retail_marketing_plan_body"),
    icon: Sparkles,
  },
  ];
}

function getTemplatePrompts(): PromptTemplates {
  const generic = getGenericPrompts();
  const code = getCodePrompts();
  const domain = getDomainExpertPrompts();
  return {
    "blank-agent": generic,
    "daily-assistant": getDailyAssistantPrompts(),
    "pixel-retail": getPixelRetailPrompts(),
    "pixel-tech": code,
    "pixel-business": domain,
    "pixel-product": domain,
  };
}

const EXPERT_PROMPT_ICONS = [Sparkles, FileText, Target];

function getCodePrompts(): PromptSuggestion[] {
  return [
  {
    title: t("session.prompt_code_code_review_title"),
    description: t("session.prompt_code_code_review_desc"),
    prompt: t("session.prompt_code_code_review_body"),
    icon: Code,
  },
  {
    title: t("session.prompt_code_implement_feature_title"),
    description: t("session.prompt_code_implement_feature_desc"),
    prompt: t("session.prompt_code_implement_feature_body"),
    icon: Code,
  },
  {
    title: t("session.prompt_code_debug_title"),
    description: t("session.prompt_code_debug_desc"),
    prompt: t("session.prompt_code_debug_body"),
    icon: Lightbulb,
  },
  {
    title: t("session.prompt_code_refactor_title"),
    description: t("session.prompt_code_refactor_desc"),
    prompt: t("session.prompt_code_refactor_body"),
    icon: Sparkles,
  },
  ];
}

// 业务专家、设计专家、电商专家等 — 按 agent ID 映射
function getDomainExpertPrompts(): PromptSuggestion[] {
  return [
  {
    title: t("session.prompt_expert_biz_analysis_title"),
    description: t("session.prompt_expert_biz_analysis_desc"),
    prompt: t("session.prompt_expert_biz_analysis_body"),
    icon: Target,
  },
  {
    title: t("session.prompt_expert_biz_plan_title"),
    description: t("session.prompt_expert_biz_plan_desc"),
    prompt: t("session.prompt_expert_biz_plan_body"),
    icon: FileText,
  },
  {
    title: t("session.prompt_expert_data_insight_title"),
    description: t("session.prompt_expert_data_insight_desc"),
    prompt: t("session.prompt_expert_data_insight_body"),
    icon: Lightbulb,
  },
  {
    title: t("session.prompt_expert_competitor_research_title"),
    description: t("session.prompt_expert_competitor_research_desc"),
    prompt: t("session.prompt_expert_competitor_research_body"),
    icon: ClipboardList,
  },
  ];
}

function resolvePrompts(
  agentId: string | null | undefined,
): PromptSuggestion[] {
  const templates = getTemplatePrompts();
  if (agentId && agentId in templates) {
    return templates[agentId];
  }
  // Fallback: agent id containing "tech"/"code" -> code prompts;
  // "business"/"product"/"retail" -> domain expert prompts.
  if (agentId) {
    if (agentId.includes("tech") || agentId.includes("code"))
      return getCodePrompts();
    if (
      agentId.includes("business") ||
      agentId.includes("product") ||
      agentId.includes("retail")
    ) {
      return getDomainExpertPrompts();
    }
  }
  return getGenericPrompts();
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
