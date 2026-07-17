/** @jsxImportSource react */
import type { ReactNode } from "react";
import { ArrowRight, ChevronRight, Copy, Link, RefreshCcw, Shield } from "lucide-react";

import { t } from "../../../../i18n";
import type {
  OnMyAgentOpenCodeRouterHealthSnapshot,
  OnMyAgentOpenCodeRouterIdentityItem,
  OnMyAgentOpenCodeRouterSendResult,
  OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";
import { DisclosureRowButton, SegmentedTabButton } from "@/components/ui/action-row";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeToken } from "@/components/ui/code-token";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SendButton } from "@/components/ui/send-button";
import { StatusBadge, StepMarker } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { SelectMenu } from "../../../design-system/select-menu";
import { LabeledInput } from "../../../design-system/labeled-input";
import { SettingsActionRow, SettingsNotice, SettingsPanel } from "../settings-section";

const agentFilePath = ".opencode/agents/opencode-router.md";
const messagingTextClass = {
  pageTitle: "text-lg font-medium leading-6 text-dls-text",
  sectionTitle: "mb-2 text-sm font-medium leading-5 text-dls-text",
  panelTitle: "text-sm font-medium leading-5 text-dls-text",
  panelDescription: "mt-0.5 text-xs leading-5 text-dls-secondary",
  metricValue: "text-sm font-medium leading-5 text-dls-text",
  mutedMetricValue: "text-sm font-medium leading-5 text-dls-secondary",
  statusValue: "text-sm font-medium leading-5",
  channelTitle: "text-base font-medium text-dls-text",
  rowTitle: "truncate text-sm font-medium text-dls-text",
  helperTitle: "text-xs font-medium text-dls-text",
  secondaryText: "text-xs text-dls-secondary",
  introText: "text-sm leading-relaxed text-dls-secondary",
  fieldLabel: "mb-1 block text-xs text-dls-secondary",
};

const messagingLayoutClass = {
  page: "space-y-6 max-w-3xl w-full",
  headerActions: "flex items-center gap-2",
  serverStatusBar: "flex flex-col gap-2 sm:flex-row sm:items-center",
  serverEndpoint: "flex flex-1 items-center gap-2 rounded-xl border border-dls-border bg-dls-surface p-1",
  riskActions: "flex flex-wrap items-center gap-2",
  healthPanel: "space-y-3.5",
  healthHeader: "flex items-center justify-between",
  healthTitleRow: "flex items-center gap-2.5",
  channelStack: "flex flex-col gap-2.5",
  channelHeader: "flex gap-3",
  channelTitleRow: "flex items-center gap-2",
  channelDescription: "mt-0.5 text-sm leading-snug text-dls-secondary",
  channelBody: "animate-in fade-in slide-in-from-top-1 space-y-3 border-t border-dls-border p-4 duration-200",
  identityList: "space-y-2",
  identityRow: "min-w-0",
  identityTitleRow: "flex items-center gap-2",
  identityMeta: "mt-0.5 pl-3.5 text-xs text-dls-secondary",
  channelActions: "flex gap-2.5",
  buttonContent: "flex items-center gap-1.5",
  setupSteps: "space-y-2 text-xs leading-relaxed text-dls-secondary",
  setupStep: "flex items-start gap-2",
  twoColumnGrid: "grid gap-2 lg:grid-cols-2",
  agentHeader: "flex items-center justify-between gap-2",
  actionRow: "flex flex-wrap items-center gap-2",
  routingRow: "flex items-center gap-2 pl-6",
  resultPanel: "space-y-1 rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2 font-mono text-xs text-dls-secondary",
};

const messagingStateClass = {
  errorText: "text-xs text-dls-status-danger-fg",
  failureText: "text-dls-status-danger-fg",
  pairingPanel: "space-y-2 rounded-xl border border-dls-accent/30 bg-dls-accent/10 px-3.5 py-3",
  pairingTitle: "text-xs font-medium text-dls-accent",
  pairingDescription: "text-xs leading-relaxed text-dls-accent/90",
};

export type MessagingViewTab = "general" | "advanced";
export type MessagingChannel = "telegram" | "slack";
export type MessagingViewExpandedChannel = MessagingChannel | null;

export type MessagingViewProps = {
  busy: boolean;
  showHeader?: boolean;
  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerUrl: string;
  scopedOnMyAgentBaseUrl?: string;
  workspaceId: string | null;
  selectedWorkspaceRoot: string;
  refreshing: boolean;
  onmyagentReconnectBusy: boolean;
  reconnectStatus: string | null;
  reconnectError: string | null;
  health: OnMyAgentOpenCodeRouterHealthSnapshot | null;
  healthError: string | null;
  messagingEnabled: boolean;
  messagingSaving: boolean;
  messagingStatus: string | null;
  messagingError: string | null;
  messagingRestartRequired: boolean;
  messagingRestartBusy: boolean;
  activeTab: MessagingViewTab;
  expandedChannel: MessagingViewExpandedChannel;
  telegram: {
    identities: OnMyAgentOpenCodeRouterIdentityItem[];
    identitiesError: string | null;
    token: string;
    enabled: boolean;
    saving: boolean;
    status: string | null;
    error: string | null;
    botUsername: string | null;
    pairingCode: string | null;
  };
  slack: {
    identities: OnMyAgentOpenCodeRouterIdentityItem[];
    identitiesError: string | null;
    botToken: string;
    appToken: string;
    enabled: boolean;
    saving: boolean;
    status: string | null;
    error: string | null;
  };
  agent: {
    loading: boolean;
    saving: boolean;
    exists: boolean;
    content: string;
    draft: string;
    status: string | null;
    error: string | null;
  };
  sendTest: {
    channel: MessagingChannel;
    directory: string;
    peerId: string;
    autoBind: boolean;
    text: string;
    busy: boolean;
    status: string | null;
    error: string | null;
    result: OnMyAgentOpenCodeRouterSendResult | null;
  };
  modals: {
    messagingRiskOpen: boolean;
    messagingRestartPromptOpen: boolean;
    messagingRestartAction: "enable" | "disable";
    messagingDisableConfirmOpen: boolean;
    publicTelegramWarningOpen: boolean;
  };
  onRepairAndReconnect: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onSelectTab: (tab: MessagingViewTab) => void;
  onToggleExpandedChannel: (channel: MessagingChannel) => void;
  onOpenMessagingRisk: () => void;
  onCancelMessagingRisk: () => void;
  onConfirmEnableMessaging: () => void | Promise<void>;
  onOpenDisableMessagingConfirm: () => void;
  onCancelDisableMessagingConfirm: () => void;
  onConfirmDisableMessaging: () => void | Promise<void>;
  onCancelRestartPrompt: () => void;
  onConfirmRestartMessagingWorker: () => void | Promise<void>;
  onTelegramTokenChange: (value: string) => void;
  onTelegramEnabledChange: (value: boolean) => void;
  onOpenPublicTelegramWarning: () => void;
  onCancelPublicTelegramWarning: () => void;
  onConfirmPublicTelegram: () => void | Promise<void>;
  onConnectPrivateTelegram: () => void | Promise<void>;
  onDeleteTelegram: (id: string) => void | Promise<void>;
  onCopyTelegramPairingCode: () => void | Promise<void>;
  onHideTelegramPairingCode: () => void;
  onSlackBotTokenChange: (value: string) => void;
  onSlackAppTokenChange: (value: string) => void;
  onSlackEnabledChange: (value: boolean) => void;
  onConnectSlack: () => void | Promise<void>;
  onDeleteSlack: (id: string) => void | Promise<void>;
  onLoadAgentFile: () => void | Promise<void>;
  onCreateDefaultAgentFile: () => void | Promise<void>;
  onChangeAgentDraft: (value: string) => void;
  onSaveAgentFile: () => void | Promise<void>;
  onChangeSendChannel: (channel: MessagingChannel) => void;
  onChangeSendPeerId: (value: string) => void;
  onChangeSendDirectory: (value: string) => void;
  onChangeSendAutoBind: (value: boolean) => void;
  onChangeSendText: (value: string) => void;
  onSendTestMessage: () => void | Promise<void>;
};

function TelegramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#229ED9" />
      <path d="M7 12.5l2.5 2L16 8.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 14.5l-.5 3 2-1.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SlackIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.5 2a2 2 0 012 2v4.5h-2a2 2 0 010-4h0V2z" fill="#E01E5A" />
      <path d="M2 9.5a2 2 0 012-2h4.5v2a2 2 0 01-4 0V9.5z" fill="#36C5F0" />
      <path d="M9.5 22a2 2 0 01-2-2v-4.5h2a2 2 0 010 4v2.5z" fill="#2EB67D" />
      <path d="M22 14.5a2 2 0 01-2 2h-4.5v-2a2 2 0 014 0h2.5z" fill="#ECB22E" />
      <path d="M8.5 9.5h2v2h-2z" fill="#36C5F0" />
      <path d="M13.5 9.5h2v2h-2z" fill="#ECB22E" />
      <path d="M8.5 14.5h2v-2h-2z" fill="#2EB67D" />
      <path d="M13.5 14.5h2v-2h-2z" fill="#E01E5A" />
    </svg>
  );
}

function MessagingMetricTile(props: { label: string; children: ReactNode; tone?: "surface" | "muted" }) {
  return (
    <div className={cn(
      "flex-1 rounded-lg border border-dls-border px-3 py-2.5",
      props.tone === "surface" ? "bg-dls-surface" : "bg-dls-surface-muted",
    )}>
      <div className="mb-0.5 text-xs text-dls-secondary">{props.label}</div>
      {props.children}
    </div>
  );
}

function formatLastActivityLabel(timestamp?: number | null) {
  if (!timestamp) return "-";
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  if (elapsedMs < 60_000) return t("identities.just_now");
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return t("identities.minutes_ago", undefined, { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("identities.hours_ago", undefined, { hours });
  const days = Math.floor(hours / 24);
  return t("identities.days_ago", undefined, { days });
}

export function MessagingView(props: MessagingViewProps) {
  const serverReady = props.onmyagentServerStatus === "connected";
  const scopedWorkspaceReady = Boolean(props.workspaceId?.trim());
  const workspaceScopeLabel =
    props.scopedOnMyAgentBaseUrl?.trim() || props.onmyagentServerUrl.trim() || t("identities.not_set");
  const defaultRoutingDirectory = props.selectedWorkspaceRoot.trim() || t("identities.not_set");
  const telegramBotLink = props.telegram.botUsername?.trim()
    ? `https://t.me/${props.telegram.botUsername.trim().replace(/^@+/, "")}`
    : null;
  const agentDirty = props.agent.draft !== props.agent.content;
  const hasTelegramConnected = props.telegram.identities.some((item) => item.enabled);
  const hasSlackConnected = props.slack.identities.some((item) => item.enabled);
  const connectedChannelCount = Number(hasTelegramConnected) + Number(hasSlackConnected);
  const messagesToday = props.health?.activity
    ? (props.health.activity.inboundToday ?? 0) + (props.health.activity.outboundToday ?? 0)
    : null;
  const lastActivityAt = props.health?.activity?.lastMessageAt ?? null;
  const lastActivityLabel = formatLastActivityLabel(lastActivityAt);
  const isWorkerOnline = props.health?.ok === true;
  const workerStatusTone = isWorkerOnline ? "accent" : props.healthError ? "danger" : "warning";
  const statusLabel = props.healthError
    ? t("identities.health_unavailable")
    : props.health
      ? props.health.ok
        ? t("identities.health_running")
        : t("identities.health_offline")
      : t("identities.health_unknown");

  return (
    <div className={messagingLayoutClass.page}>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          {props.showHeader !== false ? (
            <h1 className={messagingTextClass.pageTitle}>{t("identities.title")}</h1>
          ) : (
            <div />
          )}
          <div className={messagingLayoutClass.headerActions}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void props.onRepairAndReconnect()}
              disabled={props.busy || props.onmyagentReconnectBusy}
            >
              <RefreshCcw size={14} className={props.onmyagentReconnectBusy ? "animate-spin" : ""} />
              <span className="ml-1.5">{t("identities.repair_reconnect")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void props.onRefresh()}
              disabled={!serverReady || props.refreshing}
            >
              <RefreshCcw size={14} className={props.refreshing ? "animate-spin" : ""} />
              <span className="ml-1.5">{t("common.refresh")}</span>
            </Button>
          </div>
        </div>

        {props.showHeader !== false ? (
          <p className={messagingTextClass.introText}>{t("identities.subtitle")}</p>
        ) : null}

        <div className="mt-1.5 break-all font-mono text-xs text-dls-secondary">
          {t("identities.workspace_scope_prefix")} {workspaceScopeLabel}
        </div>
        {props.reconnectStatus ? <div className={cn("mt-1", messagingTextClass.secondaryText)}>{props.reconnectStatus}</div> : null}
        {props.reconnectError ? <div className={messagingStateClass.errorText}>{props.reconnectError}</div> : null}
        {props.messagingStatus ? <div className={cn("mt-1", messagingTextClass.secondaryText)}>{props.messagingStatus}</div> : null}
        {props.messagingError ? <div className={messagingStateClass.errorText}>{props.messagingError}</div> : null}
      </div>

      {!serverReady ? (
        <SettingsPanel size="comfortable">
          <div className={messagingTextClass.panelTitle}>{t("identities.connect_server_title")}</div>
          <div className={cn("mt-1", messagingTextClass.secondaryText)}>{t("identities.connect_server_desc")}</div>
        </SettingsPanel>
      ) : null}

      {serverReady ? (
        <>
          {!scopedWorkspaceReady ? (
            <SettingsNotice tone="warning">
              {t("identities.workspace_id_required")}
            </SettingsNotice>
          ) : null}

          {props.messagingEnabled ? (
            <div className={messagingLayoutClass.serverStatusBar}>
              <div className={messagingLayoutClass.serverEndpoint}>
                <SegmentedTabButton
                  type="button"
                  active={props.activeTab === "general"}
                  onClick={() => props.onSelectTab("general")}
                >
                  {t("identities.tab_general")}
                </SegmentedTabButton>
                <SegmentedTabButton
                  type="button"
                  active={props.activeTab === "advanced"}
                  onClick={() => props.onSelectTab("advanced")}
                >
                  {t("settings.tab_advanced")}
                </SegmentedTabButton>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={props.messagingSaving}
                onClick={props.onOpenDisableMessagingConfirm}
              >
                {t("identities.disable_messaging")}
              </Button>
            </div>
          ) : null}

          {!props.messagingEnabled ? (
            <SettingsNotice size="comfortable" className="space-y-3">
              <div className={messagingTextClass.panelTitle}>{t("identities.messaging_disabled_title")}</div>
              <p className="text-xs leading-relaxed text-dls-secondary">{t("identities.messaging_disabled_risk")}</p>
              <p className="text-xs leading-relaxed text-dls-secondary">{t("identities.messaging_disabled_hint")}</p>
              <div className={messagingLayoutClass.riskActions}>
                <Button
                  size="sm"
                  disabled={props.messagingSaving || !scopedWorkspaceReady}
                  onClick={props.onOpenMessagingRisk}
                >
                  {props.messagingSaving ? t("identities.enabling") : t("identities.enable_messaging")}
                </Button>
              </div>
            </SettingsNotice>
          ) : null}

          {props.activeTab === "general" && props.messagingEnabled ? (
            <>
              {props.messagingRestartRequired ? (
                <SettingsNotice className="leading-relaxed">
                  {t("identities.messaging_sidecar_not_running")}
                  <div className="mt-3">
                    <Button
                      size="sm"
                      disabled={props.messagingRestartBusy}
                      onClick={() => void props.onConfirmRestartMessagingWorker()}
                    >
                      {props.messagingRestartBusy ? t("identities.restarting") : t("identities.restart_worker")}
                    </Button>
                  </div>
                </SettingsNotice>
              ) : null}

              <SettingsPanel className={messagingLayoutClass.healthPanel}>
                <div className={messagingLayoutClass.healthHeader}>
                  <div className={messagingLayoutClass.healthTitleRow}>
                    <StatusDot size="sm" tone={isWorkerOnline ? "active" : "muted"} pulse={isWorkerOnline} />
                    <span className={messagingTextClass.channelTitle}>
                      {isWorkerOnline
                        ? t("identities.worker_online")
                        : props.healthError
                          ? t("identities.worker_unavailable")
                          : t("identities.worker_offline")}
                    </span>
                  </div>
                  <StatusBadge tone={workerStatusTone} shape="pill" size="tiny">
                    {statusLabel}
                  </StatusBadge>
                </div>

                {props.healthError ? (
                  <SettingsNotice tone="error" className="rounded-lg">
                    {props.healthError}
                  </SettingsNotice>
                ) : null}

                <div className={messagingLayoutClass.channelHeader}>
                  <MessagingMetricTile label={t("identities.channels_label")} tone="surface">
                    <div className={connectedChannelCount > 0 ? messagingTextClass.metricValue : messagingTextClass.mutedMetricValue}>
                      {connectedChannelCount} {t("identities.channels_connected")}
                    </div>
                  </MessagingMetricTile>
                  <MessagingMetricTile label={t("identities.messages_today")} tone="surface">
                    <div className={(messagesToday ?? 0) > 0 ? messagingTextClass.metricValue : messagingTextClass.mutedMetricValue}>
                      {messagesToday == null ? "-" : String(messagesToday)}
                    </div>
                  </MessagingMetricTile>
                  <MessagingMetricTile label={t("identities.last_activity")} tone="surface">
                    <div className={lastActivityAt ? messagingTextClass.metricValue : messagingTextClass.mutedMetricValue}>
                      {lastActivityLabel}
                    </div>
                  </MessagingMetricTile>
                </div>
              </SettingsPanel>

              <div>
                <div className={messagingTextClass.sectionTitle}>
                  {t("identities.available_channels")}
                </div>

                <div className={messagingLayoutClass.channelStack}>
                  <div
                    className={`overflow-hidden rounded-xl border transition-colors ${
                      hasTelegramConnected ? "border-dls-accent/30 bg-dls-accent/10" : "border-dls-border bg-dls-surface"
                    }`}
                  >
                    <DisclosureRowButton
                      type="button"
                      onClick={() => props.onToggleExpandedChannel("telegram")}
                    >
                      <TelegramIcon size={24} />
                      <div className="min-w-0 flex-1">
                        <div className={messagingLayoutClass.channelTitleRow}>
                          <span className={messagingTextClass.channelTitle}>Telegram</span>
                          {hasTelegramConnected ? (
                            <StatusBadge size="tiny" tone="accent">
                              {t("identities.connected_badge")}
                            </StatusBadge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-sm leading-snug text-dls-secondary">{t("identities.telegram_desc")}</div>
                      </div>
                      <ChevronRight
                        size={16}
                        className={`shrink-0 text-dls-secondary transition-transform ${
                          props.expandedChannel === "telegram" ? "rotate-90" : ""
                        }`}
                      />
                    </DisclosureRowButton>

                    {props.expandedChannel === "telegram" ? (
                      <div className={messagingLayoutClass.channelBody}>
                        {props.telegram.identitiesError ? (
                          <SettingsNotice tone="warning" className="rounded-lg">
                            {props.telegram.identitiesError}
                          </SettingsNotice>
                        ) : null}

                        {props.telegram.identities.length > 0 ? (
                          <>
                            <div className="space-y-2">
                              {props.telegram.identities.map((item) => (
                                <SettingsActionRow
                                  key={item.id}
                                  density="compact"
                                >
                                  <div className="min-w-0">
                                    <div className={messagingLayoutClass.identityTitleRow}>
                                      <StatusDot tone={item.running ? "active" : "muted"} />
                                      <span className={messagingTextClass.rowTitle}>
                                        <span className="font-mono text-xs">{item.id}</span>
                                      </span>
                                    </div>
                                    <div className={messagingLayoutClass.identityMeta}>
                                      {item.enabled ? t("identities.enabled_label") : t("identities.disabled_label")} · {item.running ? t("identities.running_label") : t("identities.stopped_label")} · {item.access === "private" ? t("identities.private_label") : t("identities.public_label")}
                                    </div>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="xs" className="shrink-0"
                                    disabled={props.telegram.saving || item.id === "env" || !scopedWorkspaceReady}
                                    onClick={() => void props.onDeleteTelegram(item.id)}
                                  >
                                    {t("identities.disconnect")}
                                  </Button>
                                </SettingsActionRow>
                              ))}
                            </div>

                            <div className="flex gap-2.5">
                              <MessagingMetricTile label={t("identities.status_label")}>
                                <div className="flex items-center gap-1.5">
                                  <StatusDot tone={props.telegram.identities.some((item) => item.running) ? "active" : "muted"} />
                                  <span
                                    className={`${messagingTextClass.statusValue} ${
                                      props.telegram.identities.some((item) => item.running)
                                        ? "text-dls-accent"
                                        : "text-dls-secondary"
                                    }`}
                                  >
                                    {props.telegram.identities.some((item) => item.running)
                                      ? t("identities.status_active")
                                      : t("identities.status_stopped")}
                                  </span>
                                </div>
                              </MessagingMetricTile>
                              <MessagingMetricTile label={t("identities.identities_label")}>
                                <div className={messagingTextClass.metricValue}>
                                  {props.telegram.identities.length} {t("identities.configured_suffix")}
                                </div>
                              </MessagingMetricTile>
                              <MessagingMetricTile label={t("identities.channel_label")}>
                                <div className={messagingTextClass.metricValue}>
                                  {props.health?.channels.telegram ? t("common.on") : t("common.off")}
                                </div>
                              </MessagingMetricTile>
                            </div>

                            {props.telegram.status ? <div className={messagingTextClass.secondaryText}>{props.telegram.status}</div> : null}
                            {props.telegram.error ? <div className={messagingStateClass.errorText}>{props.telegram.error}</div> : null}
                          </>
                        ) : null}

                        <div className="space-y-2.5">
                          {props.telegram.identities.length === 0 ? (
                            <SettingsNotice className="space-y-2.5">
                              <div className={messagingTextClass.helperTitle}>{t("identities.quick_setup")}</div>
                              <ol className={messagingLayoutClass.setupSteps}>
                                <li className={messagingLayoutClass.setupStep}>
                                  <StepMarker size="sm" className="mt-0.5">1</StepMarker>
                                  <span>
                                    {t("identities.botfather_step1_open")}{" "}
                                    <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-medium text-dls-text underline">
                                      @BotFather
                                    </a>{" "}
                                    {t("identities.botfather_step1_run")}{" "}
                                    <CodeToken>/newbot</CodeToken>.
                                  </span>
                                </li>
                                <li className={messagingLayoutClass.setupStep}>
                                  <StepMarker size="sm" className="mt-0.5">2</StepMarker>
                                  <span>{t("identities.copy_bot_token_hint")}</span>
                                </li>
                                <li className={messagingLayoutClass.setupStep}>
                                  <StepMarker size="sm" className="mt-0.5">3</StepMarker>
                                  <span>
                                    {t("identities.botfather_step3_choose")} <span className="font-medium text-dls-text">{t("identities.botfather_step3_public")}</span>{" "}
                                    {t("identities.botfather_step3_or_private")} <span className="font-medium text-dls-text">{t("identities.botfather_step3_private")}</span>{" "}
                                    {t("identities.botfather_step3_to_require")} <CodeToken>/pair &lt;code&gt;</CodeToken>.
                                  </span>
                                </li>
                              </ol>
                            </SettingsNotice>
                          ) : null}

                          <LabeledInput
                            label={t("identities.bot_token_label")}
                            placeholder={t("identities.bot_token_placeholder")}
                            type="password"
                            value={props.telegram.token}
                            onChange={(event) => props.onTelegramTokenChange(event.currentTarget.value)}
                          />

                          <label className="flex items-center gap-2 text-xs text-dls-secondary">
                            <Checkbox
                              checked={props.telegram.enabled}
                              onCheckedChange={(checked) => props.onTelegramEnabledChange(checked === true)}
                              nativeButton
                              render={<button type="button" />}
                            />
                            {t("identities.enabled_label")}
                          </label>

                          <SettingsNotice className="rounded-lg leading-relaxed">
                            {t("identities.telegram_bot_access_desc")}
                          </SettingsNotice>

                          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                            <Button
                              type="button"
                              size="lg"
                              onClick={props.onOpenPublicTelegramWarning}
                              disabled={props.telegram.saving || !scopedWorkspaceReady || !props.telegram.token.trim()}
                              className="w-full gap-2"
                            >
                              {props.telegram.saving ? (
                                <LoadingSpinner size="sm" tone="inverse" />
                              ) : (
                                <Link size={14} />
                              )}
                              {props.telegram.saving ? t("identities.connecting") : t("identities.create_public_bot")}
                            </Button>

                            <Button
                              type="button"
                              size="lg"
                              onClick={() => void props.onConnectPrivateTelegram()}
                              disabled={props.telegram.saving || !scopedWorkspaceReady || !props.telegram.token.trim()}
                              className="w-full gap-2 border-none text-white hover:opacity-90"
                              style={{ background: "#229ED9" }}
                            >
                              {props.telegram.saving ? (
                                <LoadingSpinner size="sm" tone="inverse" />
                              ) : (
                                <Shield size={14} />
                              )}
                              {props.telegram.saving ? t("identities.connecting") : t("identities.create_private_bot")}
                            </Button>
                          </div>

                          {props.telegram.pairingCode ? (
                            <div className={messagingStateClass.pairingPanel}>
                              <div className={messagingStateClass.pairingTitle}>{t("identities.private_pairing_code")}</div>
                              <CodeToken tone="info" size="md" display="block">
                                {props.telegram.pairingCode}
                              </CodeToken>
                              <div className={messagingStateClass.pairingDescription}>
                                {t("identities.pairing_code_instruction_prefix")}{" "}
                                <CodeToken tone="infoSoft" size="tiny">
                                  /pair {props.telegram.pairingCode}
                                </CodeToken>
                                .
                              </div>
                              <div className={messagingLayoutClass.headerActions}>
                                <Button variant="outline" size="xs" onClick={() => void props.onCopyTelegramPairingCode()}>
                                  <Copy size={12} />
                                  <span className="ml-1">{t("identities.copy_code")}</span>
                                </Button>
                                <Button variant="outline" size="xs" onClick={props.onHideTelegramPairingCode}>
                                  {t("common.hide")}
                                </Button>
                              </div>
                            </div>
                          ) : null}

                          {telegramBotLink ? (
                            <a
                              href={telegramBotLink}
                              target="_blank"
                              rel="noreferrer"
                              className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit text-dls-secondary" })}
                            >
                              <Link size={14} />
                              {t("identities.open_bot_link", undefined, { username: props.telegram.botUsername ?? "" })}
                            </a>
                          ) : null}

                          {props.telegram.identities.length === 0 && props.telegram.status ? (
                            <div className={messagingTextClass.secondaryText}>{props.telegram.status}</div>
                          ) : null}
                          {props.telegram.identities.length === 0 && props.telegram.error ? (
                            <div className={messagingStateClass.errorText}>{props.telegram.error}</div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={`overflow-hidden rounded-xl border transition-colors ${
                      hasSlackConnected ? "border-dls-accent/30 bg-dls-accent/10" : "border-dls-border bg-dls-surface"
                    }`}
                  >
                    <DisclosureRowButton
                      type="button"
                      onClick={() => props.onToggleExpandedChannel("slack")}
                    >
                      <SlackIcon size={24} />
                      <div className="min-w-0 flex-1">
                        <div className={messagingLayoutClass.channelTitleRow}>
                          <span className={messagingTextClass.channelTitle}>Slack</span>
                          {hasSlackConnected ? (
                            <StatusBadge size="tiny" tone="accent">
                              {t("identities.connected_badge")}
                            </StatusBadge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-sm leading-snug text-dls-secondary">{t("identities.slack_desc")}</div>
                      </div>
                      <ChevronRight
                        size={16}
                        className={`shrink-0 text-dls-secondary transition-transform ${
                          props.expandedChannel === "slack" ? "rotate-90" : ""
                        }`}
                      />
                    </DisclosureRowButton>

                    {props.expandedChannel === "slack" ? (
                      <div className={messagingLayoutClass.channelBody}>
                        {props.slack.identitiesError ? (
                          <SettingsNotice tone="warning" className="rounded-lg">
                            {props.slack.identitiesError}
                          </SettingsNotice>
                        ) : null}

                        {props.slack.identities.length > 0 ? (
                          <>
                            <div className="space-y-2">
                              {props.slack.identities.map((item) => (
                                <SettingsActionRow
                                  key={item.id}
                                  density="compact"
                                >
                                  <div className="min-w-0">
                                    <div className={messagingLayoutClass.identityTitleRow}>
                                      <StatusDot tone={item.running ? "active" : "muted"} />
                                      <span className={messagingTextClass.rowTitle}>
                                        <span className="font-mono text-xs">{item.id}</span>
                                      </span>
                                    </div>
                                    <div className={messagingLayoutClass.identityMeta}>
                                      {item.enabled ? t("identities.enabled_label") : t("identities.disabled_label")} · {item.running ? t("identities.running_label") : t("identities.stopped_label")}
                                    </div>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="xs" className="shrink-0"
                                    disabled={props.slack.saving || item.id === "env" || !scopedWorkspaceReady}
                                    onClick={() => void props.onDeleteSlack(item.id)}
                                  >
                                    {t("identities.disconnect")}
                                  </Button>
                                </SettingsActionRow>
                              ))}
                            </div>

                            <div className="flex gap-2.5">
                              <MessagingMetricTile label={t("identities.status_label")}>
                                <div className="flex items-center gap-1.5">
                                  <StatusDot tone={props.slack.identities.some((item) => item.running) ? "active" : "muted"} />
                                  <span
                                    className={`${messagingTextClass.statusValue} ${
                                      props.slack.identities.some((item) => item.running)
                                        ? "text-dls-accent"
                                        : "text-dls-secondary"
                                    }`}
                                  >
                                    {props.slack.identities.some((item) => item.running)
                                      ? t("identities.status_active")
                                      : t("identities.status_stopped")}
                                  </span>
                                </div>
                              </MessagingMetricTile>
                              <MessagingMetricTile label={t("identities.identities_label")}>
                                <div className={messagingTextClass.metricValue}>
                                  {props.slack.identities.length} {t("identities.configured_suffix")}
                                </div>
                              </MessagingMetricTile>
                              <MessagingMetricTile label={t("identities.channel_label")}>
                                <div className={messagingTextClass.metricValue}>
                                  {props.health?.channels.slack ? t("common.on") : t("common.off")}
                                </div>
                              </MessagingMetricTile>
                            </div>

                            {props.slack.status ? <div className={messagingTextClass.secondaryText}>{props.slack.status}</div> : null}
                            {props.slack.error ? <div className={messagingStateClass.errorText}>{props.slack.error}</div> : null}
                          </>
                        ) : null}

                        <div className="space-y-2.5">
                          {props.slack.identities.length === 0 ? (
                            <p className={messagingTextClass.introText}>{t("identities.slack_intro")}</p>
                          ) : null}

                          <div className="space-y-2">
                            <LabeledInput
                              label={t("identities.bot_token_label")}
                              placeholder="xoxb-..."
                              type="password"
                              value={props.slack.botToken}
                              onChange={(event) => props.onSlackBotTokenChange(event.currentTarget.value)}
                            />
                            <LabeledInput
                              label={t("identities.app_token_label")}
                              placeholder="xapp-..."
                              type="password"
                              value={props.slack.appToken}
                              onChange={(event) => props.onSlackAppTokenChange(event.currentTarget.value)}
                            />
                          </div>

                          <label className="flex items-center gap-2 text-xs text-dls-secondary">
                            <Checkbox
                              checked={props.slack.enabled}
                              onCheckedChange={(checked) => props.onSlackEnabledChange(checked === true)}
                              nativeButton
                              render={<button type="button" />}
                            />
                            {t("identities.enabled_label")}
                          </label>

                          <Button
                            type="button"
                            size="lg"
                            onClick={() => void props.onConnectSlack()}
                            disabled={props.slack.saving || !scopedWorkspaceReady || !props.slack.botToken.trim() || !props.slack.appToken.trim()}
                            className="gap-2 border-none text-white hover:opacity-90"
                            style={{ background: "#4A154B" }}
                          >
                            {props.slack.saving ? (
                              <LoadingSpinner size="sm" tone="inverse" />
                            ) : (
                              <Link size={14} />
                            )}
                            {props.slack.saving ? t("identities.connecting") : t("identities.connect_slack")}
                          </Button>

                          {props.slack.identities.length === 0 && props.slack.status ? (
                            <div className={messagingTextClass.secondaryText}>{props.slack.status}</div>
                          ) : null}
                          {props.slack.identities.length === 0 && props.slack.error ? (
                            <div className={messagingStateClass.errorText}>{props.slack.error}</div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {props.activeTab === "advanced" && props.messagingEnabled ? (
            <>
              <div>
                <div className={messagingTextClass.sectionTitle}>
                  {t("identities.message_routing_title")}
                </div>
                <p className={cn("mb-3", messagingTextClass.introText)}>{t("identities.message_routing_desc")}</p>

                <SettingsNotice className="space-y-3">
                  <div className={messagingLayoutClass.headerActions}>
                    <Shield size={16} className="text-dls-secondary" />
                    <span className="text-sm font-medium text-dls-secondary">{t("identities.default_routing")}</span>
                  </div>
                  <div className={messagingLayoutClass.routingRow}>
                    <StatusBadge shape="soft" tone="neutral">
                      {t("identities.all_channels")}
                    </StatusBadge>
                    <ArrowRight size={14} className="text-dls-secondary" />
                    <StatusBadge shape="soft" tone="accent">
                      {defaultRoutingDirectory}
                    </StatusBadge>
                  </div>
                </SettingsNotice>

                <div className={cn("mt-2.5", messagingTextClass.secondaryText)}>
                  {t("identities.routing_override_prefix")}{" "}
                  <CodeToken>/dir &lt;path&gt;</CodeToken>{" "}
                  {t("identities.routing_override_suffix")}
                </div>
              </div>

              <SettingsPanel className="space-y-3">
                <div className={messagingLayoutClass.agentHeader}>
                  <div>
                    <div className={messagingTextClass.panelTitle}>{t("identities.agent_behavior_title")}</div>
                    <div className={messagingTextClass.panelDescription}>{t("identities.agent_behavior_desc")}</div>
                  </div>
                  <CodeToken tone="surface" size="sm">
                    {agentFilePath}
                  </CodeToken>
                </div>

                {props.health?.agent ? (
                  <SettingsNotice className="rounded-lg">
                    {t("identities.agent_scope_status", undefined, {
                      status: props.health.agent.loaded ? t("identities.agent_status_loaded") : t("identities.agent_status_missing"),
                      agent: props.health.agent.selected || t("identities.agent_none"),
                    })}
                  </SettingsNotice>
                ) : null}

                {props.agent.loading ? <div className={messagingTextClass.secondaryText}>{t("identities.agent_loading")}</div> : null}

                {!props.agent.exists && !props.agent.loading ? (
                  <SettingsNotice tone="warning" className="rounded-lg">
                    {t("identities.agent_not_found")}
                  </SettingsNotice>
                ) : null}

                <Textarea
                  variant="dlsMono"
                  controlSize="editor"
                  placeholder={t("identities.agent_placeholder")}
                  value={props.agent.draft}
                  onChange={(event) => props.onChangeAgentDraft(event.currentTarget.value)}
                />

                <div className={messagingLayoutClass.actionRow}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void props.onLoadAgentFile()}
                    disabled={props.agent.loading || !scopedWorkspaceReady}
                  >
                    {t("identities.reload")}
                  </Button>
                  {!props.agent.exists ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void props.onCreateDefaultAgentFile()}
                      disabled={props.agent.saving || !scopedWorkspaceReady}
                    >
                      {t("identities.create_default_file")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={() => void props.onSaveAgentFile()}
                    disabled={props.agent.saving || !scopedWorkspaceReady || !agentDirty}
                  >
                    {props.agent.saving ? t("identities.saving") : t("identities.save_behavior")}
                  </Button>
                  {agentDirty && !props.agent.saving ? (
                    <span className={messagingTextClass.secondaryText}>{t("identities.unsaved_changes")}</span>
                  ) : null}
                </div>

                {props.agent.status ? <div className={messagingTextClass.secondaryText}>{props.agent.status}</div> : null}
                {props.agent.error ? <div className={messagingStateClass.errorText}>{props.agent.error}</div> : null}
              </SettingsPanel>

              <SettingsPanel className="space-y-3">
                <div>
                  <div className={messagingTextClass.panelTitle}>{t("identities.send_test_title")}</div>
                  <div className={messagingTextClass.panelDescription}>{t("identities.send_test_desc")}</div>
                </div>

                <div className={messagingLayoutClass.twoColumnGrid}>
                  <div>
                    <label className={messagingTextClass.fieldLabel}>{t("identities.channel_label")}</label>
                    <SelectMenu
                      ariaLabel={t("identities.channel_label")}
                      options={[
                        { value: "telegram", label: "Telegram" },
                        { value: "slack", label: "Slack" },
                      ]}
                      value={props.sendTest.channel}
                      onChange={(value) => props.onChangeSendChannel(value === "slack" ? "slack" : "telegram")}
                    />
                  </div>
                  <LabeledInput
                    label={t("identities.peer_id_label")}
                    placeholder={
                      props.sendTest.channel === "telegram"
                        ? t("identities.peer_id_placeholder_telegram")
                        : t("identities.peer_id_placeholder_slack")
                    }
                    value={props.sendTest.peerId}
                    onChange={(event) => props.onChangeSendPeerId(event.currentTarget.value)}
                  />
                </div>

                <div className={messagingLayoutClass.twoColumnGrid}>
                  <LabeledInput
                    label={t("identities.directory_label")}
                    placeholder={defaultRoutingDirectory}
                    value={props.sendTest.directory}
                    onChange={(event) => props.onChangeSendDirectory(event.currentTarget.value)}
                  />
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-xs text-dls-secondary">
                      <Checkbox
                        checked={props.sendTest.autoBind}
                        onCheckedChange={(checked) => props.onChangeSendAutoBind(checked === true)}
                        nativeButton
                        render={<button type="button" />}
                      />
                      {t("identities.auto_bind_label")}
                    </label>
                  </div>
                </div>

                <div>
                    <label className={messagingTextClass.fieldLabel}>{t("identities.message_label")}</label>
                  <Textarea
                    className="min-h-[90px]"
                    placeholder={t("identities.send_test_button")}
                    value={props.sendTest.text}
                    onChange={(event) => props.onChangeSendText(event.currentTarget.value)}
                  />
                </div>

                <div className={messagingLayoutClass.headerActions}>
                  <SendButton
                    onClick={() => void props.onSendTestMessage()}
                    disabled={props.sendTest.busy || !scopedWorkspaceReady || !props.sendTest.text.trim()}
                    loading={props.sendTest.busy}
                    label={t("identities.send_test_button")}
                  />
                  {props.sendTest.status ? <span className={messagingTextClass.secondaryText}>{props.sendTest.status}</span> : null}
                </div>

                {props.sendTest.error ? <div className={messagingStateClass.errorText}>{props.sendTest.error}</div> : null}
                {props.sendTest.result ? (
                  <div className={messagingLayoutClass.resultPanel}>
                    <div>
                      sent={props.sendTest.result.sent} attempted={props.sendTest.result.attempted}
                      {props.sendTest.result.failures?.length ? ` failures=${props.sendTest.result.failures.length}` : ""}
                      {props.sendTest.result.reason?.trim() ? ` reason=${props.sendTest.result.reason}` : ""}
                    </div>
                    {props.sendTest.result.failures?.map((failure: { identityId: string; peerId: string; error: string }) => (
                      <div key={`${failure.identityId}:${failure.peerId}:${failure.error}`} className={messagingStateClass.failureText}>
                        {failure.identityId}/{failure.peerId}: {failure.error}
                      </div>
                    ))}
                  </div>
                ) : null}
              </SettingsPanel>
            </>
          ) : null}

          <ConfirmModal
            open={props.modals.messagingRiskOpen}
            title={t("identities.enable_messaging_title")}
            message={t("identities.enable_messaging_risk")}
            confirmLabel={props.messagingSaving ? t("identities.enabling") : t("identities.enable_messaging")}
            cancelLabel={t("common.cancel")}
            variant="danger"
            onCancel={props.onCancelMessagingRisk}
            onConfirm={() => void props.onConfirmEnableMessaging()}
          />

          <ConfirmModal
            open={props.modals.messagingRestartPromptOpen}
            title={t("identities.restart_worker_title")}
            message={
              props.modals.messagingRestartAction === "enable"
                ? t("identities.restart_to_enable_messaging")
                : t("identities.restart_to_disable_messaging")
            }
            confirmLabel={props.messagingRestartBusy ? t("identities.restarting") : t("identities.restart_worker")}
            cancelLabel={t("identities.later")}
            onCancel={props.onCancelRestartPrompt}
            onConfirm={() => void props.onConfirmRestartMessagingWorker()}
          />

          <ConfirmModal
            open={props.modals.messagingDisableConfirmOpen}
            title={t("identities.disable_messaging_title")}
            message={t("identities.disable_messaging_message")}
            confirmLabel={props.messagingSaving ? t("identities.disabling") : t("identities.disable_messaging")}
            cancelLabel={t("common.cancel")}
            onCancel={props.onCancelDisableMessagingConfirm}
            onConfirm={() => void props.onConfirmDisableMessaging()}
          />

          <ConfirmModal
            open={props.modals.publicTelegramWarningOpen}
            title={t("identities.public_bot_warning_title")}
            message={t("identities.public_bot_warning_message")}
            confirmLabel={t("identities.public_bot_confirm")}
            cancelLabel={t("common.cancel")}
            variant="danger"
            confirmButtonVariant="destructive"
            onCancel={props.onCancelPublicTelegramWarning}
            onConfirm={() => void props.onConfirmPublicTelegram()}
          />
        </>
      ) : null}
    </div>
  );
}
