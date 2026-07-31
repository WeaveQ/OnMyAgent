/** @jsxImportSource react */
import { ChevronRight, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { t } from "../../../../i18n";

/**
 * Full-width sidebar primary create CTA (新建任务 / 创建专家 / 添加).
 * Black/primary border + tighter radius (lg 10, not xl 14 pill).
 * Keep in sync with automation-nav-sidebar SIDEBAR_PRIMARY_CTA_CLASS.
 */
export const SIDEBAR_PRIMARY_CTA_CLASS =
  "w-full justify-center gap-2 rounded-lg border border-dls-text bg-dls-surface-solid text-dls-text shadow-none hover:bg-dls-list-hover hover:border-dls-text before:rounded-lg";

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
      <div className="flex shrink-0 flex-col px-0 pb-2.5 pt-3.5">
        {/*
          Match automation left-rail primary CTA: full-width outline pill
          (+ icon + label), not a selected NavList row.
        */}
        <div data-assistant-primary-actions="true">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={props.onCreateTask}
            className={SIDEBAR_PRIMARY_CTA_CLASS}
          >
            <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            {t("session.new_task")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex shrink-0 flex-col gap-2.5 border-b border-dls-mist px-3 pb-2.5 pt-3.5">
      {/* Search first — scan list; create is a secondary outline action below. */}
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
        size="lg"
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
