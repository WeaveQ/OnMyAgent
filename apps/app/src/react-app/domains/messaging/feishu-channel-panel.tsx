import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FolderOpen, Play, Plug, RefreshCw, Save, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonoLogBox } from "@/components/ui/mono-log-box";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { AccessibleRootRow } from "../../design-system/accessible-root-row";
import { SelectMenu } from "../../design-system/select-menu";
import { t } from "../../../i18n";
import {
  feishuAccountStatus,
  feishuAutoStart,
  feishuProbeAccessibleRoot,
  feishuSaveAccount,
  feishuSimulateInbound,
  feishuStart,
  feishuStatus,
  feishuStop,
  type MessagingChannelStatus,
  testChannelConnection,
  type ChannelProbeResult,
  personalLocalAgentsList,
  pickDirectory,
  type PersonalLocalAgent,
  type PersonalLocalAgentApprovalMode,
} from "../../../app/lib/desktop";

type FeishuPanelState = {
  status?: string;
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  approvalMode?: PersonalLocalAgentApprovalMode;
  connectionMode?: FeishuConnectionMode;
  websocketState?: string;
  lastConnectAt?: number | null;
  lastDisconnectAt?: number | null;
  reconnectAttempts?: number;
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  webhookUrl?: string;
  lastError?: string | null;
  lastMessageAt?: number | null;
  lastRunId?: string | null;
  processedCount?: number;
  sentCount?: number;
};

type FeishuAccount = {
  accountId: string;
  appId: string;
  baseUrl: string;
  hasAppSecret: boolean;
  appSecretPreview: string;
  hasVerificationToken: boolean;
  hasEncryptKey: boolean;
};

type FeishuAccountStatusPayload = {
  account?: FeishuAccount | null;
  status?: FeishuPanelState;
  config?: {
    autoStart?: boolean;
    workspaceRoot?: string;
    accessibleWorkspaceRoots?: string[];
    approvalMode?: PersonalLocalAgentApprovalMode;
    connectionMode?: FeishuConnectionMode;
    defaultAccountId?: string;
    webhookHost?: string;
    webhookPort?: number;
    webhookPath?: string;
  };
};

type BusyAction = "refresh" | "save" | "start" | "stop" | "simulate" | "test" | null;
type FeishuPromptMode = "raw" | "debug";
type FeishuConnectionMode = "websocket" | "webhook";

const APPROVAL_MODE_OPTIONS: Array<{ value: PersonalLocalAgentApprovalMode; label: string }> = [
  { value: "ask", label: t("local_agent.approval_ask") },
  { value: "auto", label: t("local_agent.approval_auto") },
  { value: "read-only-auto", label: t("local_agent.approval_readonly_auto") },
];

const PROMPT_MODE_OPTIONS: Array<{ value: FeishuPromptMode; label: string }> = [
  { value: "raw", label: t("messaging.weixin_prompt_mode_raw") },
  { value: "debug", label: t("messaging.weixin_prompt_mode_debug") },
];

const CONNECTION_MODE_OPTIONS: Array<{ value: FeishuConnectionMode; label: string }> = [
  { value: "websocket", label: t("messaging.feishu_connection_websocket") },
  { value: "webhook", label: t("messaging.feishu_connection_webhook") },
];

const FALLBACK_AGENT: PersonalLocalAgent = {
  id: "opencode",
  name: "OpenCode",
  provider: "opencode",
  executablePath: "opencode",
  model: null,
  customArgs: [],
  modelOptions: [],
  defaultModel: null,
  status: "offline",
  version: null,
  error: null,
  lastCheckedAt: null,
};

function shortTime(value: unknown) {
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  return new Date(ms).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusTone(status: string | undefined) {
  if (status === "running") return "success";
  if (status === "backoff") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}

function agentPayload(agent: PersonalLocalAgent) {
  return {
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    executablePath: agent.executablePath,
    model: agent.model,
    customArgs: agent.customArgs,
    // Forward the resolved model list so IM-side `#model` can enumerate the
    // same choices the local chat surface shows in its picker.
    modelOptions: agent.modelOptions,
    defaultModel: agent.defaultModel,
  };
}

function PanelSection(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        // h-full: equal-height cards in the 3-column channel layout.
        "flex h-full min-w-0 flex-col gap-3 rounded-xl border border-dls-border bg-dls-surface p-4",
        props.className,
      )}
    >
      {/* Stack title + actions: side-by-side squeezes CJK to 1-char lines in 3-col cards. */}
      <div className="min-w-0 space-y-2">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-5 text-dls-text break-words">
            {props.title}
          </div>
          {props.description ? (
            <p className="mt-1 text-xs leading-5 text-dls-secondary break-words">
              {props.description}
            </p>
          ) : null}
        </div>
        {props.actions ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {props.actions}
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">{props.children}</div>
    </section>
  );
}

function FieldLabel(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs text-dls-secondary">
      <span className="font-medium text-dls-secondary">{props.label}</span>
      {props.children}
      {props.hint ? (
        <span className="text-xs leading-4 text-dls-secondary/90">{props.hint}</span>
      ) : null}
    </label>
  );
}

export function FeishuChannelPanel(props: { workspaceRoot?: string; onStatusChange?: (status: MessagingChannelStatus) => void }) {
  const [account, setAccount] = useState<FeishuAccount | null>(null);
  const [serviceState, setServiceState] = useState<FeishuPanelState>({ status: "stopped" });
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<ChannelProbeResult | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [encryptKey, setEncryptKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://open.feishu.cn");
  const [webhookHost, setWebhookHost] = useState("127.0.0.1");
  const [webhookPort, setWebhookPort] = useState("8765");
  const [webhookPath, setWebhookPath] = useState("/feishu/webhook");
  const [allowedUser, setAllowedUser] = useState("");
  const [accessWorkspaceRoot, setAccessWorkspaceRoot] = useState("");
  const [accessibleWorkspaceRoots, setAccessibleWorkspaceRoots] = useState<string[]>([]);
  const [simulateText, setSimulateText] = useState("ping");
  const [agents, setAgents] = useState<PersonalLocalAgent[]>([FALLBACK_AGENT]);
  const [selectedAgentId, setSelectedAgentId] = useState("opencode");
  const [approvalMode, setApprovalMode] = useState<PersonalLocalAgentApprovalMode>("ask");
  const [promptMode, setPromptMode] = useState<FeishuPromptMode>("raw");
  const [connectionMode, setConnectionMode] = useState<FeishuConnectionMode>("websocket");

  const applyServiceState = useCallback((nextState: FeishuPanelState) => {
    setServiceState(nextState);
    props.onStatusChange?.(nextState);
  }, [props.onStatusChange]);

  const effectiveAccountId = appId.trim() || account?.appId || account?.accountId || serviceState.accountId || "";
  const effectiveWorkspaceRoot = accessWorkspaceRoot.trim() || props.workspaceRoot?.trim() || "";
  const effectiveWebhookPort = Number(webhookPort);
  const effectiveWebhookPath = webhookPath.trim().startsWith("/") ? webhookPath.trim() : `/${webhookPath.trim()}`;
  const webhookUrl = serviceState.webhookUrl || `http://${webhookHost.trim() || "127.0.0.1"}:${Number.isFinite(effectiveWebhookPort) ? effectiveWebhookPort : 8765}${effectiveWebhookPath}`;
  const effectiveAccessibleRoots = useMemo(() => {
    const seen = new Set<string>();
    return accessibleWorkspaceRoots
      .map((root) => root.trim())
      .filter((root) => root && root !== effectiveWorkspaceRoot)
      .filter((root) => {
        if (seen.has(root)) return false;
        seen.add(root);
        return true;
      });
  }, [accessibleWorkspaceRoots, effectiveWorkspaceRoot]);
  const running = serviceState.status === "running" || serviceState.status === "backoff";
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? FALLBACK_AGENT;
  const selectedAgentSupportsApproval = selectedAgent.capability?.supportsApproval !== false;
  const selectedAgentPayload = useMemo(() => agentPayload(selectedAgent), [selectedAgent]);
  const agentsPayload = useMemo(() => agents.map(agentPayload), [agents]);
  const busyIcon = useMemo(() => busy ? <LoadingSpinner size="default" /> : null, [busy]);

  const refreshAgents = useCallback(async () => {
    try {
      const result = await personalLocalAgentsList({ workspaceRoot: effectiveWorkspaceRoot, includeModels: true });
      const nextAgents = result.agents.length ? result.agents : [FALLBACK_AGENT];
      setAgents(nextAgents);
      setSelectedAgentId((current) => nextAgents.some((agent) => agent.id === current) ? current : nextAgents[0]?.id ?? "opencode");
    } catch (agentError) {
      setAgents([FALLBACK_AGENT]);
      setSelectedAgentId("opencode");
      setError(agentError instanceof Error ? agentError.message : String(agentError));
    }
  }, [effectiveWorkspaceRoot]);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setError(null);
    try {
      const [accountResult, statusResult] = await Promise.all([
        feishuAccountStatus(effectiveAccountId ? { accountId: effectiveAccountId } : {}),
        feishuStatus(),
      ]);
      const accountPayload = accountResult as FeishuAccountStatusPayload;
      const nextAccount = accountPayload.account;
      setAccount(nextAccount ?? null);
      if (nextAccount?.appId) setAppId(nextAccount.appId);
      if (nextAccount?.baseUrl) setBaseUrl(nextAccount.baseUrl);
      const storedWorkspaceRoot = String(accountPayload.config?.workspaceRoot ?? accountPayload.status?.workspaceRoot ?? "").trim();
      if (storedWorkspaceRoot) setAccessWorkspaceRoot((current) => current.trim() ? current : storedWorkspaceRoot);
      const storedAccessibleRoots = accountPayload.config?.accessibleWorkspaceRoots ?? accountPayload.status?.accessibleWorkspaceRoots ?? [];
      if (storedAccessibleRoots.length) setAccessibleWorkspaceRoots((current) => current.length ? current : storedAccessibleRoots);
      const storedApprovalMode = accountPayload.config?.approvalMode ?? accountPayload.status?.approvalMode;
      if (storedApprovalMode === "auto" || storedApprovalMode === "ask" || storedApprovalMode === "read-only-auto") setApprovalMode(storedApprovalMode);
      const storedConnectionMode = accountPayload.config?.connectionMode ?? accountPayload.status?.connectionMode;
      if (storedConnectionMode === "webhook" || storedConnectionMode === "websocket") setConnectionMode(storedConnectionMode);
      if (accountPayload.config?.webhookHost) setWebhookHost(String(accountPayload.config.webhookHost));
      if (accountPayload.config?.webhookPort) setWebhookPort(String(accountPayload.config.webhookPort));
      if (accountPayload.config?.webhookPath) setWebhookPath(String(accountPayload.config.webhookPath));
      applyServiceState(statusResult as FeishuPanelState);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy(null);
    }
  }, [applyServiceState, effectiveAccountId]);

  useEffect(() => {
    void (async () => {
      const accountResult = await feishuAccountStatus({}).catch(() => null);
      const accountPayload = accountResult as FeishuAccountStatusPayload | null;
      const storedWorkspaceRoot = String(accountPayload?.config?.workspaceRoot ?? accountPayload?.status?.workspaceRoot ?? "").trim();
      const storedAccessibleRoots = accountPayload?.config?.accessibleWorkspaceRoots ?? accountPayload?.status?.accessibleWorkspaceRoots ?? [];
      const autoStartWorkspaceRoot = storedWorkspaceRoot || props.workspaceRoot || "";
      if (storedWorkspaceRoot) setAccessWorkspaceRoot(storedWorkspaceRoot);
      if (storedAccessibleRoots.length) setAccessibleWorkspaceRoots(storedAccessibleRoots);
      if (accountPayload?.config?.webhookHost) setWebhookHost(String(accountPayload.config.webhookHost));
      if (accountPayload?.config?.webhookPort) setWebhookPort(String(accountPayload.config.webhookPort));
      if (accountPayload?.config?.webhookPath) setWebhookPath(String(accountPayload.config.webhookPath));
      if (accountPayload?.config?.connectionMode === "webhook" || accountPayload?.config?.connectionMode === "websocket") setConnectionMode(accountPayload.config.connectionMode);
      let autoStartAgents = agents;
      const agentResult = await personalLocalAgentsList({ workspaceRoot: autoStartWorkspaceRoot, includeModels: true }).catch(() => null);
      if (agentResult) {
        autoStartAgents = agentResult.agents.length ? agentResult.agents : [FALLBACK_AGENT];
        setAgents(autoStartAgents);
      }
      const result = await feishuAutoStart({
        connectionMode: accountPayload?.config?.connectionMode ?? "websocket",
        workspaceRoot: autoStartWorkspaceRoot,
        accessibleWorkspaceRoots: storedAccessibleRoots,
        availableAgents: autoStartAgents.map(agentPayload),
      }).catch(() => null);
      if (result?.status) applyServiceState(result.status as FeishuPanelState);
      await refresh();
    })();
  }, []);

  const chooseAccessWorkspace = useCallback(async () => {
    const selected = await pickDirectory({ title: t("messaging.weixin_access_workspace_pick_title"), defaultPath: effectiveWorkspaceRoot || props.workspaceRoot });
    if (typeof selected === "string" && selected.trim()) setAccessWorkspaceRoot(selected.trim());
  }, [effectiveWorkspaceRoot, props.workspaceRoot]);

  const addAccessibleWorkspaceRoot = useCallback(async () => {
    setError(null);
    const selected = await pickDirectory({ title: t("messaging.weixin_access_workspace_extra_pick_title"), defaultPath: effectiveWorkspaceRoot || props.workspaceRoot });
    if (typeof selected !== "string" || !selected.trim()) return;
    const root = selected.trim();
    if (root === effectiveWorkspaceRoot || effectiveAccessibleRoots.includes(root)) return;
    const probe = await feishuProbeAccessibleRoot({ root });
    if (!probe.ok) {
      setError(t("messaging.weixin_access_workspace_probe_failed", { error: String(probe.error ?? "unknown error") }));
      return;
    }
    setAccessibleWorkspaceRoots((current) => [...current, root]);
  }, [effectiveAccessibleRoots, effectiveWorkspaceRoot, props.workspaceRoot]);

  const saveManualAccount = useCallback(async () => {
    setBusy("save");
    setError(null);
    try {
      const result = await feishuSaveAccount({ appId: appId.trim(), appSecret: appSecret.trim(), verificationToken: verificationToken.trim(), encryptKey: encryptKey.trim(), baseUrl: baseUrl.trim() });
      setAccount((result.account as FeishuAccount | null | undefined) ?? null);
      setAppSecret("");
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(null);
    }
  }, [appId, appSecret, baseUrl, encryptKey, refresh, verificationToken]);

  const startService = useCallback(async () => {
    setBusy("start");
    setError(null);
    try {
      const result = await feishuStart({
        accountId: effectiveAccountId,
        workspaceRoot: effectiveWorkspaceRoot,
        accessibleWorkspaceRoots: effectiveAccessibleRoots,
        agent: selectedAgentPayload,
        availableAgents: agentsPayload,
        approvalMode,
        promptMode,
        connectionMode,
        dmPolicy: allowedUser.trim() ? "allowlist" : "open",
        allowedUsers: allowedUser.trim() ? [allowedUser.trim()] : [],
        webhookHost: webhookHost.trim() || "127.0.0.1",
        webhookPort: Number.isFinite(effectiveWebhookPort) ? effectiveWebhookPort : 8765,
        webhookPath: effectiveWebhookPath,
      });
      if (result.status) applyServiceState(result.status as FeishuPanelState);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setBusy(null);
    }
  }, [agentsPayload, allowedUser, applyServiceState, approvalMode, connectionMode, effectiveAccessibleRoots, effectiveAccountId, effectiveWebhookPath, effectiveWebhookPort, effectiveWorkspaceRoot, promptMode, selectedAgentPayload, webhookHost]);

  const applyApprovalMode = useCallback(async (nextMode: PersonalLocalAgentApprovalMode) => {
    setApprovalMode(nextMode);
    if (!running) return;
    await startService();
  }, [running, startService]);

  const stopService = useCallback(async () => {
    setBusy("stop");
    setError(null);
    try {
      const result = await feishuStop();
      if (result.status) applyServiceState(result.status as FeishuPanelState);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : String(stopError));
    } finally {
      setBusy(null);
    }
  }, [applyServiceState]);

  const simulateInbound = useCallback(async () => {
    setBusy("simulate");
    setError(null);
    try {
      const result = await feishuSimulateInbound({
        accountId: effectiveAccountId,
        fromUserId: allowedUser.trim() || "ou_studio_test_user",
        chatId: "oc_studio_test_chat",
        text: simulateText.trim() || "ping",
        workspaceRoot: effectiveWorkspaceRoot,
        accessibleWorkspaceRoots: effectiveAccessibleRoots,
        agent: selectedAgentPayload,
        availableAgents: agentsPayload,
        dmPolicy: "open",
        textBatchDelayMs: 0,
        promptMode,
      });
      if (!result.ok) throw new Error(String(result.error ?? "simulate failed"));
      if (result.status) applyServiceState(result.status as FeishuPanelState);
      window.setTimeout(() => void refresh(), 500);
    } catch (simulateError) {
      setError(simulateError instanceof Error ? simulateError.message : String(simulateError));
    } finally {
      setBusy(null);
    }
  }, [agentsPayload, allowedUser, applyServiceState, effectiveAccessibleRoots, effectiveAccountId, effectiveWorkspaceRoot, promptMode, refresh, selectedAgentPayload, simulateText]);

  const testConnection = useCallback(async () => {
    setBusy("test");
    setError(null);
    setProbeResult(null);
    try {
      const result = await testChannelConnection("feishu", { accountId: effectiveAccountId });
      if (!result.ok) throw new Error(result.error ?? "connection test failed");
      setProbeResult(result);
    } catch (probeError) {
      const message = probeError instanceof Error ? probeError.message : String(probeError);
      setProbeResult({ ok: false, error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [effectiveAccountId]);

  const canStart = Boolean(effectiveAccountId && effectiveWorkspaceRoot) && !running;

  return (
    <div className="space-y-3">
      {/* Runtime status strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dls-border bg-dls-surface px-3 py-2.5 text-xs text-dls-secondary">
        <div className="flex items-center gap-2">
          <StatusBadge tone={statusTone(serviceState.status)} shape="pill" size="tiny">
            {serviceState.status ?? "stopped"}
          </StatusBadge>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={refresh}
            disabled={Boolean(busy)}
            aria-label={t("common.refresh")}
            className="text-dls-secondary hover:text-dls-text"
          >
            {busy === "refresh" ? (
              <LoadingSpinner size="default" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
        </div>
        <span className="hidden h-3 w-px bg-dls-border sm:block" aria-hidden />
        <MetricInline
          label={t("messaging.feishu_app_id")}
          value={account?.appId || effectiveAccountId || "--"}
        />
        <MetricInline
          label={t("messaging.feishu_connection_mode")}
          value={serviceState.connectionMode || connectionMode}
        />
        <MetricInline
          label={
            connectionMode === "websocket"
              ? t("messaging.feishu_websocket_state")
              : t("messaging.weixin_last_message")
          }
          value={
            connectionMode === "websocket"
              ? (serviceState.websocketState || "closed")
              : shortTime(serviceState.lastMessageAt)
          }
        />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={startService}
            disabled={!canStart || Boolean(busy)}
          >
            {busy === "start" ? busyIcon : <Play className="size-3.5" />}
            {t("messaging.weixin_start")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={stopService}
            disabled={!running || Boolean(busy)}
          >
            {busy === "stop" ? busyIcon : <Square className="size-3.5" />}
            {t("messaging.weixin_stop")}
          </Button>
        </div>
      </div>

      {serviceState.lastError || error ? (
        <NoticeBox tone="error" className="break-words leading-5">
          {serviceState.lastError || error}
        </NoticeBox>
      ) : null}

      {/* Credentials | Workspace | Routing — one row on wide screens. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <PanelSection
          title={t("messaging.feishu_app_id")}
          description={
            connectionMode === "websocket"
              ? t("messaging.feishu_websocket_desc")
              : t("messaging.feishu_webhook_desc")
          }
          actions={
            <SelectMenu
              size="compact"
              value={connectionMode}
              onChange={(value) =>
                setConnectionMode(value === "webhook" ? "webhook" : "websocket")
              }
              ariaLabel={t("messaging.feishu_connection_mode")}
              disabled={running || Boolean(busy)}
              options={CONNECTION_MODE_OPTIONS}
            />
          }
        >
          {connectionMode === "websocket" ? (
            <div className="flex flex-col gap-2">
              <Metric label={t("messaging.feishu_websocket_state")} value={serviceState.websocketState || "closed"} />
              <Metric label={t("messaging.feishu_websocket_last_connect")} value={shortTime(serviceState.lastConnectAt)} />
              <Metric label={t("messaging.feishu_websocket_reconnects")} value={String(serviceState.reconnectAttempts ?? 0)} />
            </div>
          ) : (
            <>
              <MonoLogBox>{webhookUrl}</MonoLogBox>
              <div className="flex flex-col gap-2">
                <Input
                  value={webhookHost}
                  onChange={(event) => setWebhookHost(event.currentTarget.value)}
                  placeholder="127.0.0.1"
                  disabled={running || Boolean(busy)}
                />
                <Input
                  value={webhookPort}
                  onChange={(event) => setWebhookPort(event.currentTarget.value)}
                  placeholder="8765"
                  disabled={running || Boolean(busy)}
                />
                <Input
                  value={webhookPath}
                  onChange={(event) => setWebhookPath(event.currentTarget.value)}
                  placeholder="/feishu/webhook"
                  disabled={running || Boolean(busy)}
                />
              </div>
            </>
          )}
          <div className="flex flex-col gap-2">
            <Input value={appId} onChange={(event) => setAppId(event.currentTarget.value)} placeholder="app_id / cli_xxx" />
            <Input value={appSecret} onChange={(event) => setAppSecret(event.currentTarget.value)} placeholder="app_secret" type="password" />
            <Input value={verificationToken} onChange={(event) => setVerificationToken(event.currentTarget.value)} placeholder="verification_token" type="password" />
            <Input value={encryptKey} onChange={(event) => setEncryptKey(event.currentTarget.value)} placeholder="encrypt_key (optional)" type="password" />
            <Input value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="https://open.feishu.cn" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={saveManualAccount}
              disabled={!appId.trim() || !appSecret.trim() || Boolean(busy)}
            >
              {busy === "save" ? busyIcon : <Save className="size-3.5" />}
              {t("messaging.weixin_save_account")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={testConnection}
              disabled={!effectiveAccountId || Boolean(busy)}
              title={effectiveAccountId ? undefined : t("messaging.weixin_test_need_account")}
            >
              {busy === "test" ? busyIcon : <Plug className="size-3.5" />}
              {t("messaging.weixin_test_connection")}
            </Button>
          </div>
          {probeResult ? (
            probeResult.ok ? (
              <NoticeBox tone="info" className="break-words leading-5">
                {t("messaging.weixin_test_ok", { username: probeResult.botUsername ?? "" })}
              </NoticeBox>
            ) : (
              <NoticeBox tone="error" className="break-words leading-5">
                {probeResult.error ?? t("messaging.weixin_test_failed")}
              </NoticeBox>
            )
          ) : null}
        </PanelSection>

        <PanelSection
          title={t("messaging.weixin_access_workspace_title")}
          description={t("messaging.weixin_access_workspace_desc")}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void chooseAccessWorkspace()}
                disabled={running || Boolean(busy)}
              >
                <FolderOpen className="size-3.5" />
                {t("messaging.weixin_access_workspace_pick")}
              </Button>
              {props.workspaceRoot ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAccessWorkspaceRoot(props.workspaceRoot ?? "")}
                  disabled={running || Boolean(busy)}
                >
                  {t("messaging.weixin_access_workspace_use_current")}
                </Button>
              ) : null}
            </>
          }
        >
          <Input
            className="font-mono text-xs"
            value={effectiveWorkspaceRoot}
            onChange={(event) => setAccessWorkspaceRoot(event.currentTarget.value)}
            placeholder={t("messaging.weixin_access_workspace_placeholder")}
            disabled={running || Boolean(busy)}
          />
          <div className="rounded-lg border border-dls-border/70 bg-dls-background/60 px-3 py-2.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-dls-secondary">
                {t("messaging.weixin_access_workspace_extra_title")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void addAccessibleWorkspaceRoot()}
                disabled={running || Boolean(busy)}
              >
                <FolderOpen className="size-3.5" />
                {t("messaging.weixin_access_workspace_extra_add")}
              </Button>
            </div>
            {effectiveAccessibleRoots.length ? (
              <div className="flex flex-col gap-1.5">
                {effectiveAccessibleRoots.map((root) => (
                  <AccessibleRootRow
                    key={root}
                    root={root}
                    onRemove={(target) =>
                      setAccessibleWorkspaceRoots((current) =>
                        current.filter((item) => item !== target),
                      )
                    }
                    disabled={running || Boolean(busy)}
                    removeLabel={t("messaging.weixin_access_workspace_extra_remove")}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-dls-secondary">
                {t("messaging.weixin_access_workspace_extra_empty")}
              </p>
            )}
          </div>
        </PanelSection>

        <PanelSection
          title={t("identities.message_routing_title")}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refreshAgents()}
              disabled={running || Boolean(busy)}
            >
              <RefreshCw className="size-3.5" />
              {t("common.refresh")}
            </Button>
          }
        >
          <div className="flex flex-col gap-2.5">
            <FieldLabel label={t("messaging.weixin_reply_agent")}>
              <SelectMenu
                size="compact"
                value={selectedAgent.id}
                onChange={setSelectedAgentId}
                ariaLabel={t("messaging.weixin_reply_agent")}
                disabled={running || Boolean(busy)}
                options={agents.map((agent) => ({
                  value: agent.id,
                  label: `${agent.name} (${agent.provider}${agent.status ? `/${agent.status}` : ""})`,
                }))}
              />
            </FieldLabel>
            <FieldLabel label={t("messaging.weixin_approval_mode")}>
              <SelectMenu
                size="compact"
                value={approvalMode}
                onChange={(value) => void applyApprovalMode(value as PersonalLocalAgentApprovalMode)}
                ariaLabel={t("messaging.weixin_approval_mode")}
                disabled={Boolean(busy) || !selectedAgentSupportsApproval}
                options={APPROVAL_MODE_OPTIONS}
              />
            </FieldLabel>
            <FieldLabel label={t("messaging.weixin_prompt_mode")}>
              <SelectMenu
                size="compact"
                value={promptMode}
                onChange={(value) => setPromptMode(value === "debug" ? "debug" : "raw")}
                ariaLabel={t("messaging.weixin_prompt_mode")}
                disabled={running || Boolean(busy)}
                options={PROMPT_MODE_OPTIONS}
              />
            </FieldLabel>
          </div>
          <p className="rounded-lg bg-dls-background/70 px-3 py-2 text-xs leading-5 text-dls-secondary">
            {t("messaging.feishu_agent_command_help")}
          </p>
        </PanelSection>
      </div>
    </div>
  );
}

function MetricInline(props: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      <span className="shrink-0 text-dls-secondary">{props.label}</span>
      <span className="truncate font-medium text-dls-text">{props.value}</span>
    </span>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-dls-secondary">{props.label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-dls-text">{props.value}</div>
    </div>
  );
}
