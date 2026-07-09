/** @jsxImportSource react */
import { Loader2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  agentManagementSetProxy,
  type AgentManagementSnapshot,
} from "../../../../../app/lib/desktop";
import { AgentSkillIcon } from "./agent-skill-icon";
import { SKILL_AGENT_LABELS } from "./agent-management-skill-model";
import { t } from "@/i18n";

const proxyPanelTextClass = {
  sectionTitle: "text-sm font-medium text-dls-text",
};

const proxyPanelLayoutClass = {
  section: "space-y-3",
  card: "rounded-xl border border-dls-border bg-dls-surface p-4",
  header: "flex flex-wrap items-start justify-between gap-3",
  titleWrap: "flex items-center gap-2",
  address: "mt-1 truncate text-xs text-dls-secondary",
  grid: "mt-4 grid gap-3 lg:grid-cols-2",
  subCard: "rounded-lg border border-dls-border bg-dls-surface-muted p-3",
  subHeader: "flex items-center justify-between gap-3",
  subTitle: "text-xs font-medium text-dls-text",
  subDescription: "mt-1 text-xs text-dls-secondary",
  metricsGrid: "mt-3 grid grid-cols-3 gap-2",
  agentGrid: "mt-3 space-y-2",
  agentRow: "flex items-center gap-2 rounded-lg border border-dls-border bg-dls-surface px-3 py-2",
  agentIcon: "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-dls-hover",
  select: "h-8 min-w-0 flex-1 rounded-lg border border-dls-border bg-dls-surface px-2 text-xs outline-none focus:border-dls-accent",
  appGrid: "mt-3 grid gap-2 sm:grid-cols-3",
  appCard: "rounded-lg border border-dls-border bg-dls-surface px-3 py-2",
  appTitle: "text-xs font-medium capitalize text-dls-text",
  dbPath: "mt-3 truncate text-xs text-dls-secondary",
};

type AgentManagementProxyAgent = "opencode" | "codex" | "claude" | "hermes" | "openclaw";
const AGENT_MANAGER_PROXY_OPTIONS: AgentManagementProxyAgent[] = ["opencode", "codex", "claude", "hermes", "openclaw"];

function agentManagerEnabledTone(enabled: boolean) {
  return enabled ? "success" : "neutral";
}

function AgentManagementMetric(props: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
      <div className="text-xs text-dls-secondary">{props.label}</div>
      <div className="mt-1 text-base font-medium text-dls-text">{props.value}</div>
    </div>
  );
}

export function AgentManagementProxyPanel(props: {
  snapshot: AgentManagementSnapshot | null;
  busyKey: string | null;
  onProxyAction: (input: Parameters<typeof agentManagementSetProxy>[0], busyKey: string) => void;
}) {
  const proxy = props.snapshot?.proxy;
  const address = proxy ? `${proxy.address}:${proxy.port}` : "127.0.0.1:15721";
  const studioSwitchAddress = proxy ? `${proxy.studioSwitch.address}:${proxy.studioSwitch.port}` : "127.0.0.1:15721";
  const studioProxy = proxy?.studio;
  const agentByProvider = new Map((props.snapshot?.agents ?? []).map((agent) => [agent.provider, agent]));
  return (
    <section className={proxyPanelLayoutClass.section}>
      <div className={proxyPanelLayoutClass.card}>
        <div className={proxyPanelLayoutClass.header}>
          <div className="min-w-0">
            <div className={proxyPanelLayoutClass.titleWrap}>
              <Zap className="size-4 text-dls-accent" />
              <h3 className={proxyPanelTextClass.sectionTitle}>{t("session.proxy_panel_title")}</h3>
              <StatusBadge tone={proxy?.serviceReachable ? "success" : "warning"}>
                {proxy?.serviceReachable ? t("session.proxy_service_online") : t("session.proxy_service_offline")}
              </StatusBadge>
            </div>
            <p className={proxyPanelLayoutClass.address}>{address}</p>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm"
                  type="button"
                  disabled={props.busyKey === "proxy:service"}
                  onClick={() => props.onProxyAction({ workspaceRoot: props.snapshot?.workspaceRoot ?? "", action: "service", enabled: !(proxy?.enabled ?? false), address: proxy?.address, port: proxy?.port }, "proxy:service")}
                  className={cn(proxy?.enabled ? "bg-dls-status-success-soft text-dls-status-success-fg ring-1 ring-dls-status-success-border" : "bg-dls-hover text-dls-secondary hover:bg-dls-hover")}
                  aria-label={proxy?.enabled ? t("session.proxy_toggle_disable") : t("session.proxy_toggle_enable")}
                >
                  {props.busyKey === "proxy:service" ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                </Button>
              }
            />
            <TooltipContent side="bottom">
              <span>{proxy?.enabled ? t("session.proxy_toggle_disable") : t("session.proxy_toggle_enable")}</span>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className={proxyPanelLayoutClass.grid}>
          <div className={proxyPanelLayoutClass.subCard}>
            <div className={proxyPanelLayoutClass.subHeader}>
              <div>
                <div className={proxyPanelLayoutClass.subTitle}>{t("session.proxy_studio_gateway_title")}</div>
                <div className={proxyPanelLayoutClass.subDescription}>{t("session.proxy_studio_gateway_desc")}</div>
              </div>
              <StatusBadge size="default" tone={studioProxy?.running ? "success" : agentManagerEnabledTone(Boolean(proxy?.enabled))}>{studioProxy?.running ? t("session.proxy_gateway_running") : proxy?.enabled ? t("session.proxy_enabled") : t("session.proxy_disabled")}</StatusBadge>
            </div>
            <div className={proxyPanelLayoutClass.metricsGrid}>
              <AgentManagementMetric label={t("session.proxy_metric_requests")} value={studioProxy?.totalRequests ?? 0} />
              <AgentManagementMetric label={t("session.proxy_metric_success")} value={studioProxy?.successRequests ?? 0} />
              <AgentManagementMetric label={t("session.proxy_metric_failed")} value={studioProxy?.failedRequests ?? 0} />
            </div>
            {studioProxy?.lastError ? <NoticeBox className="mt-2" tone="error">{studioProxy.lastError}</NoticeBox> : null}
            <div className={proxyPanelLayoutClass.agentGrid}>
              {AGENT_MANAGER_PROXY_OPTIONS.map((agentId) => {
                const agent = agentByProvider.get(agentId);
                const enabled = Boolean(proxy?.takeover?.[agentId]);
                const target = proxy?.targets?.[agentId] ?? agent?.model ?? agent?.defaultModel ?? "";
                const options = agent?.providerOptions ?? [];
                const busy = props.busyKey === `proxy:${agentId}`;
                return (
                  <div key={agentId} className={proxyPanelLayoutClass.agentRow}>
                    <Tooltip>
                      <TooltipTrigger render={<span className={proxyPanelLayoutClass.agentIcon}><AgentSkillIcon agent={agentId} /></span>} />
                      <TooltipContent side="bottom"><span>{SKILL_AGENT_LABELS[agentId]}</span></TooltipContent>
                    </Tooltip>
                    <select
                      value={target}
                      disabled={!agent || busy}
                      onChange={(event) => props.onProxyAction({ workspaceRoot: props.snapshot?.workspaceRoot ?? "", action: "target", agent: agentId, target: event.currentTarget.value }, `proxy:${agentId}`)}
                      className={proxyPanelLayoutClass.select}
                    >
                      {target ? <option value={target}>{target}</option> : <option value="">{t("session.proxy_no_target")}</option>}
                      {options.filter((option) => option.id !== target).map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button variant="ghost" size="icon-xs"
                            type="button"
                            disabled={!agent || busy}
                            onClick={() => props.onProxyAction({ workspaceRoot: props.snapshot?.workspaceRoot ?? "", action: "takeover", agent: agentId, enabled: !enabled }, `proxy:${agentId}`)}
                            className={cn(enabled ? "bg-dls-status-success-soft text-dls-status-success-fg ring-1 ring-dls-status-success-border" : "bg-dls-hover text-dls-secondary hover:bg-dls-hover")}
                            aria-label={enabled ? t("session.proxy_agent_release", { name: SKILL_AGENT_LABELS[agentId] }) : t("session.proxy_agent_takeover", { name: SKILL_AGENT_LABELS[agentId] })}
                          >
                            {busy ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3.5" />}
                          </Button>
                        }
                      />
                      <TooltipContent side="bottom"><span>{enabled ? t("session.proxy_release") : t("session.proxy_takeover")}</span></TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={proxyPanelLayoutClass.subCard}>
            <div className={proxyPanelLayoutClass.subHeader}>
              <div>
                <div className={proxyPanelLayoutClass.subTitle}>{t("session.proxy_studio_switch_title")}</div>
                <div className={proxyPanelLayoutClass.subDescription}>{studioSwitchAddress} · {proxy?.studioSwitch.serviceReachable ? t("session.proxy_switch_online") : t("session.proxy_switch_offline")}</div>
              </div>
              <StatusBadge size="default" tone={proxy?.studioSwitch.serviceReachable ? "success" : "neutral"}>{proxy?.studioSwitch.serviceReachable ? t("session.proxy_switch_running") : t("session.proxy_switch_not_running")}</StatusBadge>
            </div>
            <div className={proxyPanelLayoutClass.appGrid}>
              {(["claude", "codex", "gemini"] as const).map((app) => (
                <div key={app} className={proxyPanelLayoutClass.appCard}>
                  <div className={proxyPanelLayoutClass.appTitle}>{app}</div>
                  <div className={cn("mt-1 text-xs font-medium", proxy?.studioSwitch.takeover?.[app] ? "text-dls-status-success-fg" : "text-dls-secondary")}>{proxy?.studioSwitch.takeover?.[app] ? t("session.proxy_switch_taken_over") : t("session.proxy_switch_not_taken_over")}</div>
                </div>
              ))}
            </div>
            <div className={proxyPanelLayoutClass.dbPath} title={proxy?.studioSwitch.databasePath}>DB: {proxy?.studioSwitch.databasePath}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
