/** @jsxImportSource react */
import { LayoutGrid, Search } from "lucide-react";

import {
  SIDEBAR_FOOTER_CTA_CLASS,
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
export {
  SIDEBAR_FOOTER_CTA_CLASS,
  SIDEBAR_PRIMARY_CTA_CLASS,
  SIDEBAR_PRIMARY_HEADER_CLASS,
};

/** @deprecated Prefer SIDEBAR_FOOTER_CTA_CLASS — same token for home/expert/automation. */
export const EXPERT_CREATE_CTA_CLASS = SIDEBAR_FOOTER_CTA_CLASS;

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
  // Home + experts: search stays top; create CTA is pinned to panel footer.
  if (props.mode === "assistant") {
    return (
      <div
        className="relative flex w-full shrink-0 flex-col pt-1.5"
        data-assistant-search="true"
      >
        <InputGroup
          controlSize="lg"
          radius="lg"
          tone="surface"
          className="w-full"
        >
          <InputGroupAddon align="inline-start" inset="tight">
            <Search className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder={t("session.search_tasks_placeholder")}
            aria-label={t("session.search_tasks_placeholder")}
            className="text-sm placeholder:text-dls-secondary/75"
          />
        </InputGroup>
      </div>
    );
  }

  return (
    <div className="relative flex w-full shrink-0 flex-col pt-1.5">
      <InputGroup
        controlSize="lg"
        radius="lg"
        tone="surface"
        className="w-full"
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
    </div>
  );
}
