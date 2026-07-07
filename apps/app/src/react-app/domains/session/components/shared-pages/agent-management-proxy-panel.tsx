/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Globe, Loader2, Zap } from "lucide-react";
import { t } from "../../../../../i18n";

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
      <HttpProxyConfigCard proxy={proxy} onApply={(url) => props.onProxyAction({ workspaceRoot: props.snapshot?.workspaceRoot ?? "", action: "httpProxyUrl", proxyUrl: url }, "proxy:httpProxyUrl")} busy={props.busyKey === "proxy:httpProxyUrl"} />
      <div className={proxyPanelLayoutClass.card}>
        <div className={proxyPanelLayoutClass.header}>
          <div className="min-w-0">
            <div className={proxyPanelLayoutClass.titleWrap}>
              <Zap className="size-4 text-dls-accent" />
              <h3 className={proxyPanelTextClass.sectionTitle}>本地代理接管</h3>
              <StatusBadge tone={proxy?.serviceReachable ? "success" : "warning"}>
                {proxy?.serviceReachable ? "服务在线" : "服务未监听"}
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
                  aria-label={proxy?.enabled ? "关闭代理偏好" : "启用代理偏好"}
                >
                  {props.busyKey === "proxy:service" ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                </Button>
              }
            />
            <TooltipContent side="bottom">
              <span>{proxy?.enabled ? "关闭代理偏好" : "启用代理偏好"}</span>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className={proxyPanelLayoutClass.grid}>
          <div className={proxyPanelLayoutClass.subCard}>
            <div className={proxyPanelLayoutClass.subHeader}>
              <div>
                <div className={proxyPanelLayoutClass.subTitle}>Studio 本地网关</div>
                <div className={proxyPanelLayoutClass.subDescription}>当前内置协议代理支持 Claude Code / Codex；其他 Agent 保持运行时目标选择。</div>
              </div>
              <StatusBadge size="default" tone={studioProxy?.running ? "success" : agentManagerEnabledTone(Boolean(proxy?.enabled))}>{studioProxy?.running ? "网关运行中" : proxy?.enabled ? "已启用" : "未启用"}</StatusBadge>
            </div>
            <div className={proxyPanelLayoutClass.metricsGrid}>
              <AgentManagementMetric label="请求" value={studioProxy?.totalRequests ?? 0} />
              <AgentManagementMetric label="成功" value={studioProxy?.successRequests ?? 0} />
              <AgentManagementMetric label="失败" value={studioProxy?.failedRequests ?? 0} />
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
                      {target ? <option value={target}>{target}</option> : <option value="">未发现目标</option>}
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
                            aria-label={enabled ? `${SKILL_AGENT_LABELS[agentId]} 取消接管` : `${SKILL_AGENT_LABELS[agentId]} 接管`}
                          >
                            {busy ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3.5" />}
                          </Button>
                        }
                      />
                      <TooltipContent side="bottom"><span>{enabled ? "取消接管" : "接管"}</span></TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={proxyPanelLayoutClass.subCard}>
            <div className={proxyPanelLayoutClass.subHeader}>
              <div>
                <div className={proxyPanelLayoutClass.subTitle}>Studio Switch 本地路由</div>
                <div className={proxyPanelLayoutClass.subDescription}>{studioSwitchAddress} · {proxy?.studioSwitch.serviceReachable ? "在线" : "未监听"}</div>
              </div>
              <StatusBadge size="default" tone={proxy?.studioSwitch.serviceReachable ? "success" : "neutral"}>{proxy?.studioSwitch.serviceReachable ? "运行中" : "未运行"}</StatusBadge>
            </div>
            <div className={proxyPanelLayoutClass.appGrid}>
              {(["claude", "codex", "gemini"] as const).map((app) => (
                <div key={app} className={proxyPanelLayoutClass.appCard}>
                  <div className={proxyPanelLayoutClass.appTitle}>{app}</div>
                  <div className={cn("mt-1 text-xs font-medium", proxy?.studioSwitch.takeover?.[app] ? "text-dls-status-success-fg" : "text-dls-secondary")}>{proxy?.studioSwitch.takeover?.[app] ? "已接管" : "未接管"}</div>
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

function HttpProxyConfigCard(props: {
  proxy: AgentManagementSnapshot["proxy"] | undefined;
  onApply: (url: string) => void;
  busy: boolean;
}) {
  const current = props.proxy?.httpProxyUrl ?? "";
  const [value, setValue] = useState(current);
  useEffect(() => { setValue(current); }, [current]);
  return (
    <div className={proxyPanelLayoutClass.card}>
      <div className={proxyPanelLayoutClass.header}>
        <div className="min-w-0">
          <div className={proxyPanelLayoutClass.titleWrap}>
            <Globe className="size-4 text-dls-accent" />
            <h3 className={proxyPanelTextClass.sectionTitle}>{t("agent_manager.proxy_panel.http_proxy_title")}</h3>
            <StatusBadge tone={current ? "success" : "neutral"}>
              {current ? `${t("agent_manager.proxy_panel.http_proxy_current")}: ${current}` : t("agent_manager.proxy_panel.http_proxy_direct")}
            </StatusBadge>
          </div>
          <p className={proxyPanelLayoutClass.address}>{t("agent_manager.proxy_panel.http_proxy_desc")}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder={t("agent_manager.proxy_panel.http_proxy_placeholder")}
          className="h-8 min-w-0 flex-1 rounded-lg border border-dls-border bg-dls-surface px-2 text-xs outline-none focus:border-dls-accent"
          disabled={props.busy}
          spellCheck={false}
        />
        <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onApply(value.trim())}>
          {props.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t("agent_manager.proxy_panel.http_proxy_apply")}
        </Button>
        <Button size="sm" variant="ghost" disabled={props.busy || !current} onClick={() => { setValue(""); props.onApply(""); }}>
          {t("agent_manager.proxy_panel.http_proxy_clear")}
        </Button>
      </div>
    </div>
  );
}
