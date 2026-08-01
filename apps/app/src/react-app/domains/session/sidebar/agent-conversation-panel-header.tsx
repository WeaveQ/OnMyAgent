/** @jsxImportSource react */
import { LayoutGrid, Plus, Search } from "lucide-react";

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

/**
 * Expert create CTA under search: filled, borderless so it doesn't stack a
 * second outline against the search field. Geometry still matches sidebar-cta.
 */
const EXPERT_CREATE_CTA_CLASS =
  "mac:titlebar-no-drag border-0 bg-dls-surface-muted text-dls-text shadow-none hover:bg-dls-hover hover:text-dls-text before:rounded-lg";

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
    <div className="relative flex w-full shrink-0 flex-col gap-2 pt-1.5">
      {/*
        Expert list: bordered search (field) + borderless filled create (action).
        Avoids two stacked outlines of the same weight.
      */}
      <InputGroup controlSize="lg" radius="lg" tone="surface" className="w-full">
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
      <Button
        type="button"
        variant="ghost"
        size="sidebar-cta"
        onClick={props.onCreateExpert}
        className={EXPERT_CREATE_CTA_CLASS}
      >
        <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
        {t("session.create_expert")}
      </Button>
    </div>
  );
}
