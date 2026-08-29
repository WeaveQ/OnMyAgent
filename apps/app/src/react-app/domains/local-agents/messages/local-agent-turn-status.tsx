/** @jsxImportSource react */
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";

function statusLabel(
  status: PersonalLocalAgentRunResult["status"],
  durationLabel: string | null,
) {
  switch (status) {
    case "completed":
      return t("local_agent.turn_thought_duration", {
        duration: durationLabel ?? t("local_agent.elapsed_seconds", { count: 0 }),
      });
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
  const status = statusLabel(props.status, props.durationLabel);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="mb-1 h-6 justify-start gap-1 px-0 text-sm font-normal leading-6 text-dls-secondary hover:bg-transparent hover:text-dls-text"
      aria-expanded={props.expanded}
      onClick={() => props.onExpandedChange(!props.expanded)}
      data-testid="local-agent-turn-status"
    >
      <span>{status}</span>
      <ChevronDown
        size={12}
        className={cn(
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          !props.expanded && "-rotate-90",
        )}
      />
    </Button>
  );
}
