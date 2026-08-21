/** @jsxImportSource react */
import { ChevronDown } from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";

function statusLabel(status: PersonalLocalAgentRunResult["status"]) {
  switch (status) {
    case "completed":
      return t("local_agent.status_completed");
    case "failed":
      return t("local_agent.status_failed");
    case "cancelled":
      return t("local_agent.status_cancelled");
    case "missing":
      return t("local_agent.status_missing");
    default:
      return t("local_agent.status_running");
  }
}

export function LocalAgentTurnStatus(props: {
  status: PersonalLocalAgentRunResult["status"];
  durationLabel: string | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const status = statusLabel(props.status);
  return (
    <button
      type="button"
      className="mb-1 inline-flex min-h-6 items-center gap-1 rounded-sm border-0 bg-transparent p-0 text-sm leading-6 text-dls-secondary outline-none hover:text-dls-text focus-visible:ring-1 focus-visible:ring-dls-focus focus-visible:ring-offset-0"
      aria-expanded={props.expanded}
      onClick={() => props.onExpandedChange(!props.expanded)}
      data-testid="local-agent-turn-status"
    >
      <span>
        {status}
        {props.durationLabel ? ` ${props.durationLabel}` : ""}
      </span>
      <ChevronDown
        size={12}
        className={cn("transition-transform", !props.expanded && "-rotate-90")}
      />
    </button>
  );
}
