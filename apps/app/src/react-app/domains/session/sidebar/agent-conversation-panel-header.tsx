/** @jsxImportSource react */
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SIDEBAR_PRIMARY_CTA_CLASS,
  SIDEBAR_PRIMARY_HEADER_CLASS,
} from "@/components/ui/sidebar-chrome";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
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
    <div className={cn("relative", SIDEBAR_PRIMARY_HEADER_CLASS)}>
      {/*
        Expert list: search only. Create expert lives in store market header.
        Same h-14 + pt bias as home CTA strip (LIST_LANE / SIDEBAR_PRIMARY).
      */}
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
    </div>
  );
}
