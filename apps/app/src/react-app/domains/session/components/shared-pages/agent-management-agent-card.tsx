/** @jsxImportSource react */
import { HeartPulse, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
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
}) {
  const usage = props.agent.usage;

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
            <span className="truncate">{props.agent.version || props.agent.executablePath}</span>
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

    </section>
  );
}
