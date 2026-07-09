/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { HeartPulse, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AgentManagementAgent } from "../../../../../app/lib/desktop";
import { SelectMenu } from "../../../../design-system/select-menu";
import { AGENT_MANAGER_PROVIDER_LABELS } from "./agent-management-providers";
import { t } from "../../../../../i18n";
import {
  agentManagerHealthLabel,
  agentManagerHealthTone,
  agentManagerStatusTone,
  formatAgentManagerDuration,
  formatAgentManagerTime,
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
  busy: boolean;
  health?: AgentManagementHealthResult;
  checking: boolean;
  onSwitch: (agent: AgentManagementAgent, model: string) => void;
  onHealthCheck: (agent: AgentManagementAgent) => void;
}) {
  const [selectedModel, setSelectedModel] = useState(props.agent.model || props.agent.defaultModel || "");

  useEffect(() => {
    setSelectedModel(props.agent.model || props.agent.defaultModel || "");
  }, [props.agent.defaultModel, props.agent.model]);

  const usage = props.agent.usage;
  const modelOptions = props.agent.providerOptions;
  const canSwitch = props.agent.status === "online" && selectedModel.trim();

  return (
    <section className="rounded-xl border border-dls-border bg-dls-surface p-4">
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
          <p className="mt-1 truncate text-xs text-dls-secondary">{AGENT_MANAGER_PROVIDER_LABELS[props.agent.provider] ?? props.agent.provider} · {props.agent.version || props.agent.executablePath}</p>
        </div>
        <HeartPulse className="size-4 shrink-0 text-dls-secondary" />
      </div>

      {props.agent.error ? <NoticeBox className="mt-3 leading-5" tone="error">{props.agent.error}</NoticeBox> : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <AgentManagementMetric label={t("session.agent_mgmt_metric_runs")} value={usage.runs} />
        <AgentManagementMetric label={t("session.agent_mgmt_metric_completed_failed")} value={`${usage.completed} / ${usage.failed}`} />
        <AgentManagementMetric label={t("session.agent_mgmt_metric_duration")} value={formatAgentManagerDuration(usage.totalDurationMs)} />
        <AgentManagementMetric label="Skill" value={props.agent.skillCount} />
      </div>

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

      <div className="mt-4 rounded-lg border border-dls-border bg-dls-surface-muted p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-dls-text">{t("session.agent_mgmt_switch_title")}</span>
          <span className="text-xs text-dls-secondary">{t("session.agent_mgmt_switch_last_run", { value: formatAgentManagerTime(usage.lastRunAt) })}</span>
        </div>
        {modelOptions.length > 0 ? (
          <div className="flex gap-2">
            <SelectMenu
              ariaLabel={t("session.agent_mgmt_switch_title")}
              size="compact"
              options={modelOptions.map((option) => ({ value: option.id, label: option.label }))}
              value={selectedModel}
              onChange={setSelectedModel}
            />
            <Button size="sm" variant="outline" disabled={!canSwitch || props.busy} onClick={() => props.onSwitch(props.agent, selectedModel)}>
              {t("session.agent_mgmt_switch_apply")}
            </Button>
          </div>
        ) : (
          <div className="text-xs text-dls-secondary">{t("session.agent_mgmt_switch_empty")}</div>
        )}
      </div>
    </section>
  );
}
