/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { ArrowUpCircle, HeartPulse, Loader2, RefreshCw } from "lucide-react";

import { t } from "../../../../../i18n";
import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AgentManagementAgent } from "../../../../../app/lib/desktop";
import { SelectMenu } from "../../../../design-system/select-menu";
import { AGENT_MANAGER_PROVIDER_LABELS } from "./agent-management-providers";
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
  onRecheckVersion?: (agent: AgentManagementAgent) => void;
  onOpenUpdateDialog?: (agent: AgentManagementAgent) => void;
  versionChecking?: boolean;
  updateDismissed?: boolean;
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
              {props.agent.status === "online" ? "健康" : props.agent.status === "offline" ? "离线" : "异常"}
            </StatusBadge>
            <StatusBadge tone={agentManagerHealthTone(props.agent, props.health)}>
              {agentManagerHealthLabel(props.agent, props.health)}
            </StatusBadge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dls-secondary">
            <span className="truncate">{AGENT_MANAGER_PROVIDER_LABELS[props.agent.provider] ?? props.agent.provider}</span>
            {props.agent.version ? (
              <span>{t("agent_manager.update.local_version", { version: props.agent.version })}</span>
            ) : (
              <span className="truncate">{props.agent.executablePath}</span>
            )}
            {props.agent.latestVersion ? (
              <span>{t("agent_manager.update.latest_version", { version: props.agent.latestVersion })}</span>
            ) : null}
            {props.agent.updateAvailable && !props.updateDismissed ? (
              <StatusBadge tone="warning" data-testid={`agent-manager-card-update-badge-${props.agent.provider}`}>
                {t("agent_manager.update.available", { version: props.agent.latestVersion ?? "" })}
              </StatusBadge>
            ) : null}
            {props.agent.versionCheckError ? (
              <StatusBadge tone="danger" title={props.agent.versionCheckError}>{t("agent_manager.update.error_registry_failed")}</StatusBadge>
            ) : null}
            {props.onRecheckVersion ? (
              <Button
                size="sm"
                variant="ghost"
                className="mac:titlebar-no-drag h-6 px-1.5"
                title={t("agent_manager.update.check")}
                aria-label={t("agent_manager.update.check")}
                disabled={props.versionChecking}
                onClick={() => props.onRecheckVersion?.(props.agent)}
                data-testid={`agent-manager-card-recheck-btn-${props.agent.provider}`}
              >
                {props.versionChecking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              </Button>
            ) : null}
            {props.agent.updateAvailable && !props.updateDismissed && props.onOpenUpdateDialog ? (
              <Button
                size="sm"
                variant="outline"
                className="mac:titlebar-no-drag h-6 px-2"
                onClick={() => props.onOpenUpdateDialog?.(props.agent)}
                data-testid={`agent-manager-card-update-btn-${props.agent.provider}`}
              >
                <ArrowUpCircle className="mr-1 size-3.5" />
                {t("agent_manager.update.update_now")}
              </Button>
            ) : null}
          </div>
        </div>
        <HeartPulse className="size-4 shrink-0 text-dls-secondary" />
      </div>

      {props.agent.error ? <NoticeBox className="mt-3 leading-5" tone="error">{props.agent.error}</NoticeBox> : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <AgentManagementMetric label="运行次数" value={usage.runs} />
        <AgentManagementMetric label="成功 / 失败" value={`${usage.completed} / ${usage.failed}`} />
        <AgentManagementMetric label="总耗时" value={formatAgentManagerDuration(usage.totalDurationMs)} />
        <AgentManagementMetric label="Skill" value={props.agent.skillCount} />
      </div>

      <div className="mt-4 rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-dls-text">运行健康检查</div>
            <div className="mt-1 truncate text-xs text-dls-secondary">
              {props.health?.output || props.health?.error || props.agent.connectionMode || "检测安装、认证和当前 Agent 可执行链路"}
            </div>
          </div>
          <Button
            size="sm"
            variant="dashed"
            disabled={props.agent.status !== "online" || props.checking}
            onClick={() => props.onHealthCheck(props.agent)}
          >
            {props.checking ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <HeartPulse className="mr-1.5 size-3.5" />}
            检查
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-dls-border bg-dls-surface-muted p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-dls-text">供应商 / 模型切换</span>
          <span className="text-xs text-dls-secondary">上次运行 {formatAgentManagerTime(usage.lastRunAt)}</span>
        </div>
        {modelOptions.length > 0 ? (
          <div className="flex gap-2">
            <SelectMenu
              ariaLabel="供应商 / 模型切换"
              size="compact"
              options={modelOptions.map((option) => ({ value: option.id, label: option.label }))}
              value={selectedModel}
              onChange={setSelectedModel}
            />
            <Button size="sm" variant="outline" disabled={!canSwitch || props.busy} onClick={() => props.onSwitch(props.agent, selectedModel)}>
              应用
            </Button>
          </div>
        ) : (
          <div className="text-xs text-dls-secondary">未发现可切换的供应商或模型配置</div>
        )}
      </div>
    </section>
  );
}
