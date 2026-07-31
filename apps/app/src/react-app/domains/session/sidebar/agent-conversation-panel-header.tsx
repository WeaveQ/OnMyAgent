/** @jsxImportSource react */
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { t } from "../../../../i18n";

/**
 * Surface/border for full-width list-lane create CTA.
 * Size geometry lives on Button `size="sidebar-cta"` (h-10 + rounded-lg).
 * Keep in sync with automation-nav-sidebar SIDEBAR_PRIMARY_CTA_CLASS.
 * DESIGN.md components.contracts.sidebar-primary-cta.
 */
export const SIDEBAR_PRIMARY_CTA_CLASS =
  "border border-dls-border bg-dls-surface-solid text-dls-text shadow-none hover:bg-dls-hover hover:border-dls-border before:rounded-lg";

/**
 * Top strip for sidebar primary CTA — same h-14 as SessionSurfaceHeader
 * so list-lane “新建任务” and main “助手” title row share one baseline
 * with a bit more vertical air under the mac titlebar.
 */
export const SIDEBAR_PRIMARY_HEADER_CLASS =
  // pt bias so the h-10 CTA sits slightly below vertical center (less titlebar-tight).
  "flex h-14 shrink-0 items-center pt-1.5";

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
    <div className="relative flex h-14 shrink-0 items-center pt-2">
      {/*
        Expert list: search only. Create expert lives in store market header.
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
