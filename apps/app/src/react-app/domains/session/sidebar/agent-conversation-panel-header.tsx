/** @jsxImportSource react */
import { Bot, ChevronRight, Clock3, MessageCirclePlus, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NavListButton } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { t } from "../../../../i18n";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import {
  AssistantCategorySwitch,
  AssistantMenuRow,
  type AssistantMenuItem,
} from "./assistant-sidebar-controls";

type AgentConversationPanelHeaderProps = {
  mode: "agent" | "assistant";
  query: string;
  selectedSessionId: string | null;
  showAgentSelectionTip?: boolean;
  assistantCategoryId?: AssistantCategoryId;
  automationActive?: boolean;
  onQueryChange: (value: string) => void;
  onOpenAgents: () => void;
  onCreateTask?: () => void;
  onOpenAssistant?: () => void;
  onAssistantCategoryChange?: (id: AssistantCategoryId) => void;
  onOpenAutomation?: () => void;
};

export function AgentConversationPanelHeader(props: AgentConversationPanelHeaderProps) {
  const assistantMenuItems: AssistantMenuItem[] = [
    { id: "automation", label: t("nav.automation"), icon: Clock3 },
  ];

  if (props.mode === "assistant") {
    return (
      <div className="space-y-0 pb-1 pt-3">
        {props.assistantCategoryId && props.onAssistantCategoryChange ? (
          <AssistantCategorySwitch
            value={props.assistantCategoryId}
            onChange={props.onAssistantCategoryChange}
          />
        ) : null}
        <div className="grid gap-1" data-assistant-primary-actions="true">
          <NavListButton
            type="button"
            onClick={props.onCreateTask}
            active={!props.selectedSessionId && !props.automationActive}
            size="sidebar"
            className="font-medium"
          >
            <MessageCirclePlus className="size-4 shrink-0" />
            {t("session.new_task")}
          </NavListButton>
          {assistantMenuItems.map((item) => (
            <AssistantMenuRow
              key={item.id}
              item={item}
              active={item.id === "automation" && props.automationActive}
              onClick={item.id === "automation" ? props.onOpenAutomation : props.onOpenAssistant}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-12 shrink-0 items-start gap-2.5 border-b border-dls-mist px-4 py-2">
      <InputGroup controlSize="sm" radius="md" tone="surfaceMuted" className="flex-1">
        <InputGroupAddon align="inline-start" inset="tight">
          <Search className="size-5" />
        </InputGroupAddon>
        <InputGroupInput
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("agents.search")}
          className="h-8 text-sm placeholder:text-dls-secondary/75"
        />
      </InputGroup>
      <div className="relative shrink-0">
        <Button
          type="button"
          size="icon-sm"
          onClick={props.onOpenAgents}
          className="relative shrink-0 border border-dls-border bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          title={t("session.choose_expert_agent")}
          aria-label={t("session.choose_expert_agent")}
        >
          <Bot className="size-5" />
          <Plus className="absolute right-1.5 top-1.5 size-2.5" strokeWidth={3} />
        </Button>
        {props.showAgentSelectionTip ? (
          <div className="absolute left-1/2 top-10 z-30 w-60 rounded-lg border border-dls-accent/30 bg-dls-surface p-3">
            <span className="absolute -top-1.5 left-3 size-3 rotate-45 border-l border-t border-dls-accent/30 bg-dls-surface" aria-hidden="true" />
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
              <Bot className="size-3" />
              {t("session.choose_expert_agent_tip_action")}
              <ChevronRight className="size-3" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
