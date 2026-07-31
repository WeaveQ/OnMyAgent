/** @jsxImportSource react */
import { ChevronRight, Clock3, MessageCirclePlus, Plus, Search } from "lucide-react";

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
      <div className="space-y-0 pb-2.5 pt-3.5">
        {props.assistantCategoryId && props.onAssistantCategoryChange ? (
          <AssistantCategorySwitch
            value={props.assistantCategoryId}
            onChange={props.onAssistantCategoryChange}
          />
        ) : null}
        <div className="grid gap-1.5" data-assistant-primary-actions="true">
          {/*
            XOR selection: only the current view gets soft wash.
            - New task: draft home (no session, not on automation)
            - Automation: scheduledTasks rail
            Never force permanent muted fill — that made both rows look selected.
          */}
          <NavListButton
            type="button"
            onClick={props.onCreateTask}
            active={!props.selectedSessionId && !props.automationActive}
            size="sidebar"
          >
            <MessageCirclePlus className="size-4 shrink-0" strokeWidth={1.75} />
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
    <div className="relative flex shrink-0 flex-col gap-2.5 border-b border-dls-mist px-3 pb-2.5 pt-3.5">
      {/* Full-width create control — match automation rail density (not icon-sm +). */}
      <Button
        type="button"
        size="default"
        onClick={props.onOpenAgents}
        className="h-10 w-full justify-center gap-2 rounded-xl border-0 bg-dls-surface-muted text-sm font-medium text-dls-text shadow-none hover:bg-dls-hover hover:text-dls-text"
        title={t("session.create_expert")}
        aria-label={t("session.create_expert")}
      >
        <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
        {t("session.create_expert")}
      </Button>
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
      {props.showAgentSelectionTip ? (
        <div className="absolute left-3 right-3 top-[4.5rem] z-30 rounded-lg border border-dls-accent/30 bg-dls-surface-solid p-3">
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
