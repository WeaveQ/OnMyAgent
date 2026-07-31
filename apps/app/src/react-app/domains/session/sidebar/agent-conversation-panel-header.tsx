/** @jsxImportSource react */
import { ChevronRight, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { t } from "../../../../i18n";

/**
 * Full-width sidebar primary create CTA (新建任务 / 创建专家 / 添加).
 * Soft outline: h-9 + rounded-xl + hairline border.
 * Keep in sync with automation-nav-sidebar SIDEBAR_PRIMARY_CTA_CLASS.
 */
export const SIDEBAR_PRIMARY_CTA_CLASS =
  "h-9 w-full justify-center gap-2 rounded-xl border border-dls-border bg-dls-surface-solid text-sm font-medium text-dls-text shadow-none hover:bg-dls-hover hover:border-dls-border before:rounded-xl";

/**
 * Top strip for sidebar primary CTA — same h-12 as SessionSurfaceHeader
 * so list-lane “新建任务” and main “助手” title row share one baseline.
 */
export const SIDEBAR_PRIMARY_HEADER_CLASS =
  "flex h-12 shrink-0 items-center";

type AgentConversationPanelHeaderProps = {
  mode: "agent" | "assistant";
  query: string;
  selectedSessionId: string | null;
  showAgentSelectionTip?: boolean;
  automationActive?: boolean;
  onQueryChange: (value: string) => void;
  onOpenAgents: () => void;
  onCreateTask?: () => void;
  onOpenAssistant?: () => void;
  onOpenAutomation?: () => void;
};

export function AgentConversationPanelHeader(props: AgentConversationPanelHeaderProps) {
  if (props.mode === "assistant") {
    return (
      <div
        className={SIDEBAR_PRIMARY_HEADER_CLASS}
        data-assistant-primary-actions="true"
      >
        {/*
          Full-width outline pill, vertically centered in the shared h-12
          chrome row (aligns with SessionSurfaceHeader / automation CTA).
        */}
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={props.onCreateTask}
          className={SIDEBAR_PRIMARY_CTA_CLASS}
        >
          <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          {t("session.new_task")}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex shrink-0 flex-col gap-2 border-b border-dls-mist px-0 pb-2.5 pt-2">
      {/* Search + create share compact chrome; h-9 controls match primary CTA. */}
      <InputGroup controlSize="sm" radius="md" tone="surfaceMuted" className="w-full">
        <InputGroupAddon align="inline-start" inset="tight">
          <Search className="size-4" />
        </InputGroupAddon>
        <InputGroupInput
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("agents.search")}
          className="h-9 text-sm placeholder:text-dls-secondary/75"
        />
      </InputGroup>
      <Button
        type="button"
        variant="outline"
        size="default"
        onClick={props.onOpenAgents}
        className={SIDEBAR_PRIMARY_CTA_CLASS}
        title={t("session.create_expert")}
        aria-label={t("session.create_expert")}
      >
        <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
        {t("session.create_expert")}
      </Button>
      {props.showAgentSelectionTip ? (
        <div className="absolute left-3 right-3 top-[5.75rem] z-30 rounded-lg border border-dls-accent/30 bg-dls-surface-solid p-3">
          <span
            className="absolute -top-1.5 left-6 size-3 rotate-45 border-l border-t border-dls-accent/30 bg-dls-surface"
            aria-hidden="true"
          />
          <div className="text-xs font-medium leading-5 text-dls-accent">
            {t("session.choose_expert_agent_tip_title")}
          </div>
          <div className="mt-1 text-xs leading-5 text-dls-secondary">
            {t("session.choose_expert_agent_tip_desc")}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={props.onOpenAgents}
            className="mt-2 bg-dls-accent/10 text-dls-accent hover:bg-dls-accent/10 hover:text-dls-accent"
          >
            <Plus className="size-3" strokeWidth={2} />
            {t("session.choose_expert_agent_tip_action")}
            <ChevronRight className="size-3" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
