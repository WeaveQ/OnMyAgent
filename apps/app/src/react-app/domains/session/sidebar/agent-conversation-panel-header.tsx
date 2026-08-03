/** @jsxImportSource react */
import { LayoutGrid, Plus, Search, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SIDEBAR_PRIMARY_CTA_CLASS,
  SIDEBAR_PRIMARY_HEADER_CLASS,
} from "@/components/ui/sidebar-chrome";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { t } from "../../../../i18n";

// Re-export for callers that imported chrome from this header module.
export { SIDEBAR_PRIMARY_CTA_CLASS, SIDEBAR_PRIMARY_HEADER_CLASS };

type AgentConversationPanelHeaderProps = {
  mode: "agent" | "assistant";
  query: string;
  selectedSessionId: string | null;
  automationActive?: boolean;
  onQueryChange: (value: string) => void;
  onOpenAgents: () => void;
  onCreateExpert?: () => void;
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
          Full-width outline CTA in shared h-14 strip (SessionSurfaceHeader /
          automation CTA baseline — DESIGN.md sidebar-primary-cta).
        */}
        <Button
          type="button"
          variant="outline"
          size="sidebar-cta"
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
    <div className="relative flex w-full shrink-0 items-center gap-1.5 pt-1.5">
      {/*
        Expert list: search (with marketplace grid) + create as a separate
        icon button to the right of the field — not inside the input.
      */}
      <InputGroup
        controlSize="lg"
        radius="lg"
        tone="surface"
        className="min-w-0 flex-1"
      >
        <InputGroupAddon align="inline-start" inset="tight">
          <Search className="size-4" />
        </InputGroupAddon>
        <InputGroupInput
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("agents.search")}
          className="text-sm placeholder:text-dls-secondary/75"
        />
        <InputGroupAddon align="inline-end" className="pe-1">
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={props.onOpenAgents}
            className="mac:titlebar-no-drag rounded-lg text-dls-secondary hover:text-dls-text"
            title={t("session.summon_experts")}
            aria-label={t("session.summon_experts")}
          >
            <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {props.onCreateExpert ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={props.onCreateExpert}
          className="mac:titlebar-no-drag size-10 shrink-0 rounded-lg border-dls-border text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          title={t("session.create_expert")}
          aria-label={t("session.create_expert")}
          data-expert-create="true"
        >
          <UserPlus className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
