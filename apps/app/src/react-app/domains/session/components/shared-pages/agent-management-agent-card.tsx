/** @jsxImportSource react */
import { HeartPulse, Loader2, Pencil, Trash2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { t } from "../../../../../i18n";
import { cn } from "@/lib/utils";
import type { AgentManagementAgent } from "../../../../../app/lib/desktop";
import { AGENT_MANAGER_PROVIDER_LABELS } from "./agent-management-providers";
import {
  agentManagerHealthLabel,
  agentManagerHealthTone,
  agentManagerStatusTone,
  formatAgentManagerDuration,
  type AgentManagementHealthResult,
} from "./agent-management-health";

function AgentManagementMetric(props: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
      <div className="text-xs text-dls-secondary">{props.label}</div>
      <div className="mt-1 text-base font-medium text-dls-text">{props.value}</div>
    </div>
  );
}

export function AgentManagementAgentCard(props: {
  agent: AgentManagementAgent;
  health?: AgentManagementHealthResult;
  checking: boolean;
  onHealthCheck: (agent: AgentManagementAgent) => void;
  onToggleEnabled?: (agent: AgentManagementAgent, enabled: boolean) => void;
  onDelete?: (agent: AgentManagementAgent) => void;
  onEdit?: (agent: AgentManagementAgent) => void;
  onRepair?: (agent: AgentManagementAgent) => void;
}) {
  const isCustom = props.agent.provider === "custom";
  const enabled = props.agent.enabled !== false;
  const usage = props.agent.usage;

  return (
    <section className={cn("rounded-xl border border-dls-border bg-dls-surface p-4", isCustom && !enabled ? "opacity-60" : "")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-medium text-dls-text">{props.agent.name}</h3>
            <StatusBadge tone={agentManagerStatusTone(props.agent.status)}>
              {props.agent.status === "online" ? t("session.agent_mgmt_status_online") : props.agent.status === "offline" ? t("session.agent_mgmt_status_offline") : t("session.agent_mgmt_status_error")}
            </StatusBadge>
            <StatusBadge tone={agentManagerHealthTone(props.agent, props.health)}>
              {agentManagerHealthLabel(props.agent, props.health)}
            </StatusBadge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dls-secondary">
            <span className="truncate">{AGENT_MANAGER_PROVIDER_LABELS[props.agent.provider] ?? props.agent.provider}</span>
            <span className="truncate">{props.agent.version || props.agent.executablePath}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isCustom ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={t("agent_manager.custom_agents_edit")}
                aria-label={t("agent_manager.custom_agents_edit")}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onEdit?.(props.agent);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={t("agent_manager.custom_agents_delete")}
                aria-label={t("agent_manager.custom_agents_delete")}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onDelete?.(props.agent);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
              <Switch
                checked={enabled}
                size="sm"
                onCheckedChange={(value) => props.onToggleEnabled?.(props.agent, value)}
                onClick={(event) => event.stopPropagation()}
                aria-label={enabled ? t("agent_manager.custom_agents_enabled") : t("agent_manager.custom_agents_disabled")}
              />
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={t("agent_manager.repair_title", { name: props.agent.name })}
              aria-label={t("agent_manager.repair_title", { name: props.agent.name })}
              onClick={(event) => {
                event.stopPropagation();
                props.onRepair?.(props.agent);
              }}
            >
              <Wrench className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {props.agent.error ? <NoticeBox className="mt-3 leading-5" tone="error">{props.agent.error}</NoticeBox> : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <AgentManagementMetric label={t("session.agent_mgmt_metric_runs")} value={usage.runs} />
        <AgentManagementMetric label={t("session.agent_mgmt_metric_completed_failed")} value={`${usage.completed} / ${usage.failed}`} />
        <AgentManagementMetric label={t("session.agent_mgmt_metric_duration")} value={formatAgentManagerDuration(usage.totalDurationMs)} />
        <AgentManagementMetric label="Skill" value={props.agent.skillCount} />
      </div>

      {isCustom ? null : (
        <div className="mt-4 rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-dls-text">{t("session.agent_mgmt_health_title")}</div>
              <div className="mt-1 truncate text-xs text-dls-secondary">
                {props.health?.output || props.health?.error || props.agent.connectionMode || t("session.agent_mgmt_health_desc_default")}
              </div>
            </div>
            <Button
              size="sm"
              variant="dashed"
              disabled={props.agent.status !== "online" || props.checking}
              onClick={() => props.onHealthCheck(props.agent)}
            >
              {props.checking ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <HeartPulse className="mr-1.5 size-3.5" />}
              {t("session.agent_mgmt_health_check")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
