import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { memo } from "react";
import { KeyRound, Settings2, Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import type { PersonalLocalAgent, PersonalLocalAgentTestConnectionResult } from "../../../app/lib/desktop";
import { AgentBrandIcon } from "./agent-brand-icon";
import { localAgentStatus } from "./local-agent-filters";
import { localAgentStatusDescriptor } from "./local-agent-status";

export type LocalAgentCardProps = {
  agent: PersonalLocalAgent;
  iconUrl?: string | null;
  providerLabel: string;
  selected?: boolean;
  testing?: boolean;
  testResult?: PersonalLocalAgentTestConnectionResult | null;
  onSelect?: (agentId: string) => void;
  onTestConnection?: (agent: PersonalLocalAgent) => void;
  onConfigure?: (agent: PersonalLocalAgent) => void;
};

// Local Agent card with provider identity, status, diagnostics, and connection actions.
export const LocalAgentCard = memo(function LocalAgentCard(props: LocalAgentCardProps) {
  const { agent } = props;
  const status = localAgentStatus(agent);
  const descriptor = localAgentStatusDescriptor(status, agent.error);
  const diagnostic =
    agent.error ||
    props.testResult?.error ||
    (status === "online" ? t("local_agent.status_online_diag") : t("local_agent.status_unknown"));

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 transition-colors",
        props.selected ? "border-dls-accent/40 bg-dls-accent/5" : "border-dls-border bg-dls-surface hover:bg-dls-hover",
      )}
      data-testid="local-agent-card"
      data-agent-id={agent.id}
      data-status={status}
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-3 text-left"
        onClick={() => props.onSelect?.(agent.id)}
      >
        <AgentBrandIcon
          id={agent.id}
          provider={agent.provider}
          src={props.iconUrl}
          size="md"
          alt={agent.name}
          badge={
            <span
              className={cn(
                "absolute -right-0.5 bottom-0 size-3 rounded-full border-2 border-dls-surface",
                descriptor.dotClass,
              )}
              title={descriptor.label}
            />
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-dls-text">{agent.name}</span>
            <StatusBadge tone={descriptor.tone} size="tiny" title={diagnostic}>
              {descriptor.label}
            </StatusBadge>
          </div>
          <div className="mt-1 truncate text-xs text-dls-secondary">{props.providerLabel}</div>
        </div>
      </button>

      <div className="min-h-0 truncate text-xs text-dls-secondary" title={diagnostic}>
        {diagnostic}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => props.onTestConnection?.(agent)}
          disabled={props.testing}
          title={t("local_agent.test_connection")}
        >
          {props.testing ? <LoadingSpinner size="sm" className="mr-1.5" /> : <Wifi className="mr-1.5 size-3.5" />}
          {t("local_agent.test_connection")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => props.onConfigure?.(agent)}
          title={t("local_agent.configure")}
        >
          <Settings2 className="mr-1.5 size-3.5" />
          {t("local_agent.configure")}
        </Button>
        {status === "needs_auth" ? (
          <StatusBadge tone="warning" size="tiny" className="ml-auto">
            <KeyRound className="size-3" />
            {t("local_agent.status_needs_auth")}
          </StatusBadge>
        ) : null}
        {props.testResult ? (
          <StatusBadge
            tone={props.testResult.ok ? "success" : "danger"}
            size="tiny"
            className="ml-auto"
            title={props.testResult.error ?? undefined}
          >
            {props.testResult.ok ? t("local_agent.test_connection_ok") : t("local_agent.test_connection_failed")}
          </StatusBadge>
        ) : null}
      </div>
    </div>
  );
});
LocalAgentCard.displayName = "LocalAgentCard";
