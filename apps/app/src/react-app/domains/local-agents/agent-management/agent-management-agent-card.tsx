import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { Bot, ChevronRight, HeartPulse, Loader2, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import claudeIconUrl from "../../../../assets/agent-icons/claude.svg";
import codexIconUrl from "../../../../assets/agent-icons/openai.svg";
import hermesIconUrl from "../../../../assets/agent-icons/hermes.png";
import openclawIconUrl from "../../../../assets/agent-icons/claw.svg";
import opencodeIconUrl from "../../../../assets/agent-icons/opencode-logo-light.svg";
import geminiIconUrl from "../../../../assets/agent-icons/gemini.svg";
import kiroIconUrl from "../../../../assets/agent-icons/kiro.svg";
import gooseIconUrl from "../../../../assets/agent-icons/goose.svg";
import cursorAgentIconUrl from "../../../../assets/agent-icons/cursor-agent.svg";
import qwenIconUrl from "../../../../assets/agent-icons/qwen.svg";
import kimiIconUrl from "../../../../assets/agent-icons/kimi.svg";
import copilotIconUrl from "../../../../assets/agent-icons/copilot.svg";
import qoderIconUrl from "../../../../assets/agent-icons/qoder.svg";
import augmentIconUrl from "../../../../assets/agent-icons/augment.svg";
import snowIconUrl from "../../../../assets/agent-icons/snow.svg";
import nanobotIconUrl from "../../../../assets/agent-icons/nanobot.svg";
import codebuddyIconUrl from "../../../../assets/agent-icons/codebuddy.svg";
import traeIconUrl from "../../../../assets/agent-icons/trae.svg";
import mimoIconUrl from "../../../../assets/agent-icons/mimo.svg";
import grokIconUrl from "../../../../assets/agent-icons/grok.svg";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { t } from "../../../../i18n";
import { cn } from "@/lib/utils";
import type { AgentManagementAgent } from "../../../../app/lib/desktop";
import { localAgentTypeLabel } from "./agent-management-providers";
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

// Each agent shows its own brand icon instead of a unified fallback glyph.
// Matched by agent id first (so the discoverable catalog like CodeBuddy/Gemini
// gets its real icon), then by provider for the built-in 5 + user custom agents.
const AGENT_ICON_BY_ID: Partial<Record<string, string>> = {
  opencode: opencodeIconUrl,
  codex: codexIconUrl,
  claude: claudeIconUrl,
  hermes: hermesIconUrl,
  openclaw: openclawIconUrl,
  gemini: geminiIconUrl,
  kiro: kiroIconUrl,
  goose: gooseIconUrl,
  "cursor-agent": cursorAgentIconUrl,
  qwen: qwenIconUrl,
  kimi: kimiIconUrl,
  copilot: copilotIconUrl,
  qoder: qoderIconUrl,
  augment: augmentIconUrl,
  snow: snowIconUrl,
  nanobot: nanobotIconUrl,
  codebuddy: codebuddyIconUrl,
  trae: traeIconUrl,
  mimo: mimoIconUrl,
  grok: grokIconUrl,
};

const AGENT_ICON_BY_PROVIDER: Partial<Record<string, string>> = {
  opencode: opencodeIconUrl,
  codex: codexIconUrl,
  claude: claudeIconUrl,
  hermes: hermesIconUrl,
  openclaw: openclawIconUrl,
};

function AgentManagementAgentIcon(props: { id: string; provider: string }) {
  const src = AGENT_ICON_BY_ID[props.id] ?? AGENT_ICON_BY_PROVIDER[props.provider];
  if (src) {
    return <img src={src} alt="" className="size-5 object-contain" loading="lazy" />;
  }
  return <Bot className="size-5" />;
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
  // Upstream-style: rows are collapsed by default and only reveal their data
  // and detail operations after the user clicks to expand them.
  const [expanded, setExpanded] = useState(false);

  return (
    <section data-testid={`agent-card-${props.agent.id}`} className={cn("overflow-hidden rounded-xl border border-dls-border bg-dls-surface", isCustom && !enabled ? "opacity-60" : "")}>
      <button
        type="button"
        data-testid={`agent-card-toggle-${props.agent.id}`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded
          ? t("agent_manager.agent_card.collapse", { name: props.agent.name })
          : t("agent_manager.agent_card.expand", { name: props.agent.name })}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-dls-surface-muted"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-dls-surface-muted text-dls-secondary">
          <AgentManagementAgentIcon id={props.agent.id} provider={props.agent.provider} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-medium text-dls-text">{props.agent.name}</span>
            <StatusBadge tone={agentManagerStatusTone(props.agent.status)} shape="pill" size="tiny">
              {props.agent.status === "online"
                ? t("agent_manager.agent_card.status_online")
                : props.agent.status === "needs_auth"
                  ? t("agent_manager.agent_card.status_needs_auth")
                  : props.agent.status === "offline"
                    ? t("agent_manager.agent_card.status_offline")
                    : props.agent.status === "missing"
                      ? t("agent_manager.agent_card.status_missing")
                      : t("agent_manager.agent_card.status_error")}
            </StatusBadge>
            {(() => {
              const healthLabel = agentManagerHealthLabel(
                props.agent,
                props.health,
              );
              if (!healthLabel) return null;
              return (
                <StatusBadge
                  tone={agentManagerHealthTone(props.agent, props.health)}
                  shape="pill"
                  size="tiny"
                >
                  {healthLabel}
                </StatusBadge>
              );
            })()}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dls-secondary">
            <span className="truncate">{localAgentTypeLabel(props.agent)}</span>
            <span className="truncate">{props.agent.version || props.agent.executablePath}</span>
          </div>
        </div>
        <ChevronRight className={cn("size-4 shrink-0 text-dls-secondary transition-transform duration-200", expanded && "rotate-90")} />
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
