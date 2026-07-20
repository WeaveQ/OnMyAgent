import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { ChevronRight, HeartPulse, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { t } from "../../../../i18n";
import { cn } from "@/lib/utils";
import type { AgentManagementAgent } from "../../../../app/lib/desktop";
import { AgentBrandIcon } from "../agent-brand-icon";
import { localAgentTypeLabel } from "./agent-management-providers";
import {
  agentManagerHealthLabel,
  agentManagerHealthTone,
  agentManagerStatusTone,
  formatAgentManagerDuration,
  type AgentManagementHealthResult,
} from "./agent-management-health";
import { agentDisplayStatus, agentVersionLabel } from "./agent-card-model";

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
  /** True while catalog → fleet adopt is in flight. */
  adding?: boolean;
  onTestConnection: (agent: AgentManagementAgent) => void;
  onToggleEnabled?: (agent: AgentManagementAgent, enabled: boolean) => void;
  onDelete?: (agent: AgentManagementAgent) => void;
  onEdit?: (agent: AgentManagementAgent) => void;
  onRepair?: (agent: AgentManagementAgent) => void;
  /** Adopt a catalog (discoverable) agent into My agents. */
  onAddAsCustom?: (agent: AgentManagementAgent) => void;
}) {
  // Discoverable catalog entries are stored with provider "custom" so the ACP
  // test-connection path works, but they are NOT user-registered agents — they
  // must stay read-only (no edit/delete/enable) until adopted into the fleet.
  const isDiscoverable = props.agent.discoverable === true;
  const isCustom = props.agent.provider === "custom" && !isDiscoverable;
  const enabled = props.agent.enabled !== false;
  const usage = props.agent.usage;
  // Unified with fleet partition filters (未安装 / 健康 / 离线 / 需登录).
  const displayStatus = agentDisplayStatus(props.agent, props.health);
  // Upstream-style: rows are collapsed by default and only reveal their data
  // and detail operations after the user clicks to expand them.
  const [expanded, setExpanded] = useState(false);

  // Collapsed meta: type · version only. Paths / bare command names (codex, hermes)
  // used to leak in as fallbacks and made cards look inconsistent.
  const versionLabel = agentVersionLabel(props.agent);
  const metaSecondary = versionLabel ? versionLabel.replace(/^v/i, "") : null;
  const statusLabel =
    displayStatus === "online"
      ? t("agent_manager.agent_card.status_online")
      : displayStatus === "needs_auth"
        ? t("agent_manager.agent_card.status_needs_auth")
        : displayStatus === "offline"
          ? t("agent_manager.agent_card.status_offline")
          : displayStatus === "missing"
            ? t("agent_manager.agent_card.status_missing")
            : t("agent_manager.agent_card.status_error");
  const healthLabel = agentManagerHealthLabel(props.agent, props.health);

  return (
    <section
      data-testid={`agent-card-${props.agent.id}`}
      className={cn(
        // h-full + flex so grid cells in the same row share equal card height
        "flex h-full flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface",
        isCustom && !enabled ? "opacity-60" : "",
      )}
    >
      <button
        type="button"
        data-testid={`agent-card-toggle-${props.agent.id}`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded
          ? t("agent_manager.agent_card.collapse", { name: props.agent.name })
          : t("agent_manager.agent_card.expand", { name: props.agent.name })}
        className={cn(
          // items-center: chevron vertically centered in the card header
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-dls-surface-muted",
          // Collapsed: fill grid cell so same-row cards share equal height.
          // Expanded: keep header natural height so metrics/actions stay compact.
          !expanded && "min-h-full flex-1",
        )}
      >
        <AgentBrandIcon
          id={props.agent.id}
          provider={props.agent.provider}
          size="sm"
          alt={props.agent.name}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          {/* Title + status top-right */}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 truncate text-base font-medium leading-5 text-dls-text">
              {props.agent.name}
            </div>
            <div className="flex max-w-[48%] shrink-0 flex-wrap items-center justify-end gap-1">
              <StatusBadge tone={agentManagerStatusTone(displayStatus)} shape="pill" size="tiny">
                {statusLabel}
              </StatusBadge>
              {healthLabel ? (
                <StatusBadge
                  tone={agentManagerHealthTone(props.agent, props.health)}
                  shape="pill"
                  size="tiny"
                >
                  {healthLabel}
                </StatusBadge>
              ) : null}
            </div>
          </div>
          {/* Meta: product type · version (omit path/command noise) */}
          <div className="mt-1 truncate text-xs text-dls-secondary">
            <span>{localAgentTypeLabel(props.agent)}</span>
            {metaSecondary ? (
              <>
                <span className="mx-1.5 text-dls-border" aria-hidden>
                  ·
                </span>
                <span title={String(props.agent.version ?? metaSecondary)}>{metaSecondary}</span>
              </>
            ) : null}
          </div>
        </div>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 self-center text-dls-secondary transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded ? (
        <div className="border-t border-dls-border px-4 pb-4 pt-3">
          {props.agent.error ? <NoticeBox className="mb-3 leading-5" tone="error">{props.agent.error}</NoticeBox> : null}

          <div className="grid grid-cols-2 gap-2">
            <AgentManagementMetric label={t("agent_manager.agent_card.metric_runs")} value={usage.runs} />
            <AgentManagementMetric label={t("agent_manager.agent_card.metric_success_failure")} value={`${usage.completed} / ${usage.failed}`} />
            <AgentManagementMetric label={t("agent_manager.agent_card.metric_total_duration")} value={formatAgentManagerDuration(usage.totalDurationMs)} />
            <AgentManagementMetric label={t("agent_manager.agent_card.metric_skill")} value={props.agent.skillCount} />
          </div>

          <div className="mt-3 rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-dls-text">{t("agent_manager.agent_card.health_check_title")}</div>
                <div className="mt-1 truncate text-xs text-dls-secondary">
                  {props.health?.output || props.health?.error || props.agent.connectionMode || t("agent_manager.agent_card.health_check_desc")}
                </div>
              </div>
              <Button
                size="sm"
                variant="dashed"
                disabled={props.checking}
                onClick={() => props.onTestConnection(props.agent)}
              >
                {props.checking ? <LoadingSpinner size="sm" className="mr-1.5" /> : <HeartPulse className="mr-1.5 size-3.5" />}
                {t("agent_manager.agent_card.health_check")}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isCustom ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => props.onEdit?.(props.agent)}
                >
                  <Pencil className="mr-1.5 size-3.5" />
                  {t("agent_manager.custom_agents_edit")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => props.onDelete?.(props.agent)}
                >
                  <Trash2 className="mr-1.5 size-3.5" />
                  {t("agent_manager.custom_agents_delete")}
                </Button>
                <label className="ml-auto flex items-center gap-2 text-xs text-dls-secondary">
                  {enabled ? t("agent_manager.custom_agents_enabled") : t("agent_manager.custom_agents_disabled")}
                  <Switch
                    checked={enabled}
                    size="sm"
                    onCheckedChange={(value) => props.onToggleEnabled?.(props.agent, value)}
                    aria-label={enabled ? t("agent_manager.custom_agents_enabled") : t("agent_manager.custom_agents_disabled")}
                  />
                </label>
              </>
            ) : isDiscoverable ? (
              <div className="flex w-full flex-wrap items-center gap-2">
                <span className="text-xs text-dls-secondary">
                  {t("agent_manager.agent_card.discoverable_hint")}
                </span>
                {props.onAddAsCustom ? (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="ml-auto"
                    disabled={props.adding || props.checking}
                    onClick={() => props.onAddAsCustom?.(props.agent)}
                  >
                    {props.adding ? <LoadingSpinner size="sm" className="mr-1.5" /> : <Plus className="mr-1.5 size-3.5" />}
                    {t("agent_manager.agent_card.add_as_mine")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => props.onRepair?.(props.agent)}
              >
                <Wrench className="mr-1.5 size-3.5" />
                {t("agent_manager.repair_title", { name: props.agent.name })}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
