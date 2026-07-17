import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, FolderOpen, Play, Plug, QrCode, RefreshCw, Save, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonoLogBox } from "@/components/ui/mono-log-box";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { SelectMenu } from "../../design-system/select-menu";
import { AccessibleRootRow } from "../../design-system/accessible-root-row";
import { t } from "../../../i18n";
import {
  openDesktopUrl,
  personalLocalAgentsList,
  pickDirectory,
  type PersonalLocalAgent,
  type PersonalLocalAgentApprovalMode,
  weixinAccountStatus,
  weixinAutoStart,
  weixinLoginPoll,
  weixinLoginStart,
  weixinProbeAccessibleRoot,
  weixinSaveAccount,
  weixinSimulateInbound,
  weixinStart,
  weixinStatus,
  weixinStop,
  testChannelConnection,
  type ChannelProbeResult,
} from "../../../app/lib/desktop";

type WeixinPanelState = {
  status?: string;
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  approvalMode?: PersonalLocalAgentApprovalMode;
  lastError?: string | null;
  lastPollAt?: number | null;
  lastMessageAt?: number | null;
  lastRunId?: string | null;
  processedCount?: number;
  sentCount?: number;
};

type WeixinAccount = {
  accountId: string;
  baseUrl: string;
  userId: string;
  hasToken: boolean;
  tokenPreview: string;
};

type WeixinAccountStatusPayload = {
  account?: WeixinAccount | null;
  status?: WeixinPanelState;
  config?: {
    autoStart?: boolean;
    workspaceRoot?: string;
    accessibleWorkspaceRoots?: string[];
    approvalMode?: PersonalLocalAgentApprovalMode;
    defaultAccountId?: string;
  };
};

type BusyAction = "refresh" | "save" | "login" | "poll" | "start" | "stop" | "simulate" | "test" | null;
type WeixinPromptMode = "raw" | "debug";

const APPROVAL_MODE_OPTIONS: Array<{ value: PersonalLocalAgentApprovalMode; label: string }> = [
  { value: "ask", label: t("local_agent.approval_ask") },
  { value: "auto", label: t("local_agent.approval_auto") },
  { value: "read-only-auto", label: t("local_agent.approval_readonly_auto") },
];

const PROMPT_MODE_OPTIONS: Array<{ value: WeixinPromptMode; label: string }> = [
  { value: "raw", label: t("messaging.weixin_prompt_mode_raw") },
  { value: "debug", label: t("messaging.weixin_prompt_mode_debug") },
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
  if (status === "backoff" || status === "needs_login") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}

function PanelSection(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-dls-text">{props.title}</div>
          {props.description ? (
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-dls-secondary">
              {props.description}
            </p>
          ) : null}
        </div>
        {props.actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {props.actions}
          </div>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

function FieldLabel(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="min-w-0 text-xs text-dls-secondary">
      <span className="mb-1 block">{props.label}</span>
      {props.children}
      {props.hint ? <span className="mt-1 block text-xs leading-4 text-dls-secondary">{props.hint}</span> : null}
    </label>
  );
}

export function WeixinChannelPanel(props: { workspaceRoot?: string; onStatusChange?: (status: WeixinPanelState) => void }) {
  const { onStatusChange } = props;
  const [account, setAccount] = useState<WeixinAccount | null>(null);
  const [serviceState, setServiceState] = useState<WeixinPanelState>({ status: "stopped" });
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<ChannelProbeResult | null>(null);
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://ilinkai.weixin.qq.com");
  const [allowedUser, setAllowedUser] = useState("");
  const [accessWorkspaceRoot, setAccessWorkspaceRoot] = useState("");
  const [accessibleWorkspaceRoots, setAccessibleWorkspaceRoots] = useState<string[]>([]);
  const [simulateText, setSimulateText] = useState("ping");
  const [agents, setAgents] = useState<PersonalLocalAgent[]>([FALLBACK_AGENT]);
  const [selectedAgentId, setSelectedAgentId] = useState("opencode");
  const [approvalMode, setApprovalMode] = useState<PersonalLocalAgentApprovalMode>("ask");
  const [promptMode, setPromptMode] = useState<WeixinPromptMode>("raw");
  const [qrCode, setQrCode] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrImageDataUrl, setQrImageDataUrl] = useState("");
  const [qrStatus, setQrStatus] = useState("");
  const [qrPollBaseUrl, setQrPollBaseUrl] = useState("");
  const [qrAutoPoll, setQrAutoPoll] = useState(false);
  const [qrPollCount, setQrPollCount] = useState(0);
  const [qrLastPollAt, setQrLastPollAt] = useState<number | null>(null);
  const [qrLastPollBaseUrl, setQrLastPollBaseUrl] = useState("");
  const [qrRedirectHost, setQrRedirectHost] = useState("");
  const [qrPollDetail, setQrPollDetail] = useState("");

  const effectiveAccountId = accountId.trim() || account?.accountId || serviceState.accountId || "";
  const effectiveWorkspaceRoot = accessWorkspaceRoot.trim() || props.workspaceRoot?.trim() || "";
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
  const canStart = Boolean(effectiveAccountId && effectiveWorkspaceRoot) && !running;
  const canSimulate = Boolean(effectiveAccountId && allowedUser.trim());
  const busyIcon = useMemo(() => busy ? <LoadingSpinner size="default" /> : null, [busy]);
  const qrScanValue = qrCodeUrl || qrCode;
  const qrImageUrl = qrImageDataUrl;
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? FALLBACK_AGENT;
  const selectedAgentSupportsApproval = selectedAgent.capability?.supportsApproval !== false;
  const agentPayload = useMemo(() => ({
    id: selectedAgent.id,
    name: selectedAgent.name,
    provider: selectedAgent.provider,
    executablePath: selectedAgent.executablePath,
    model: selectedAgent.model,
    customArgs: selectedAgent.customArgs,
  }), [selectedAgent]);

  const refreshAgents = useCallback(async () => {
    try {
      const result = await personalLocalAgentsList({ workspaceRoot: effectiveWorkspaceRoot, includeModels: false });
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
        weixinAccountStatus(effectiveAccountId ? { accountId: effectiveAccountId } : {}),
        weixinStatus(),
      ]);
      const accountPayload = accountResult as WeixinAccountStatusPayload;
      const nextAccount = accountPayload.account;
      setAccount(nextAccount ?? null);
      if (nextAccount?.accountId) setAccountId(nextAccount.accountId);
      if (nextAccount?.baseUrl) setBaseUrl(nextAccount.baseUrl);
      const storedWorkspaceRoot = String(accountPayload.config?.workspaceRoot ?? accountPayload.status?.workspaceRoot ?? "").trim();
      if (storedWorkspaceRoot) setAccessWorkspaceRoot((current) => current.trim() ? current : storedWorkspaceRoot);
      const storedAccessibleRoots = accountPayload.config?.accessibleWorkspaceRoots ?? accountPayload.status?.accessibleWorkspaceRoots ?? [];
      if (storedAccessibleRoots.length) setAccessibleWorkspaceRoots((current) => current.length ? current : storedAccessibleRoots);
      const storedApprovalMode = accountPayload.config?.approvalMode ?? accountPayload.status?.approvalMode;
      if (storedApprovalMode === "auto" || storedApprovalMode === "ask" || storedApprovalMode === "read-only-auto") setApprovalMode(storedApprovalMode);
      setServiceState(statusResult as WeixinPanelState);
      onStatusChange?.(statusResult as WeixinPanelState);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy(null);
    }
  }, [effectiveAccountId, onStatusChange]);

  useEffect(() => {
    void (async () => {
      const accountResult = await weixinAccountStatus({}).catch(() => null);
      const accountPayload = accountResult as WeixinAccountStatusPayload | null;
      const storedWorkspaceRoot = String(accountPayload?.config?.workspaceRoot ?? accountPayload?.status?.workspaceRoot ?? "").trim();
      const storedAccessibleRoots = accountPayload?.config?.accessibleWorkspaceRoots ?? accountPayload?.status?.accessibleWorkspaceRoots ?? [];
      const storedApprovalMode = accountPayload?.config?.approvalMode ?? accountPayload?.status?.approvalMode;
      const autoStartWorkspaceRoot = storedWorkspaceRoot || props.workspaceRoot || "";
      if (storedWorkspaceRoot) setAccessWorkspaceRoot(storedWorkspaceRoot);
      if (storedAccessibleRoots.length) setAccessibleWorkspaceRoots(storedAccessibleRoots);
      if (storedApprovalMode === "auto" || storedApprovalMode === "ask" || storedApprovalMode === "read-only-auto") setApprovalMode(storedApprovalMode);
      let autoStartAgents = agents;
      const agentResult = await personalLocalAgentsList({ workspaceRoot: autoStartWorkspaceRoot, includeModels: false }).catch((agentError) => {
        setAgents([FALLBACK_AGENT]);
        setSelectedAgentId("opencode");
        setError(agentError instanceof Error ? agentError.message : String(agentError));
        return null;
      });
      if (agentResult) {
        autoStartAgents = agentResult.agents.length ? agentResult.agents : [FALLBACK_AGENT];
        setAgents(autoStartAgents);
        setSelectedAgentId((current) => autoStartAgents.some((agent) => agent.id === current) ? current : autoStartAgents[0]?.id ?? "opencode");
      }
      const result = await weixinAutoStart({
        workspaceRoot: autoStartWorkspaceRoot,
        accessibleWorkspaceRoots: storedAccessibleRoots,
        availableAgents: autoStartAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          executablePath: agent.executablePath,
          model: agent.model,
          customArgs: agent.customArgs,
        })),
      }).catch(() => null);
      if (result?.status) {
        setServiceState(result.status as WeixinPanelState);
        onStatusChange?.(result.status as WeixinPanelState);
      }
      await refresh();
    })();
  }, []);

  const chooseAccessWorkspace = useCallback(async () => {
    const selected = await pickDirectory({
      title: t("messaging.weixin_access_workspace_pick_title"),
      defaultPath: effectiveWorkspaceRoot || props.workspaceRoot,
    });
    if (typeof selected === "string" && selected.trim()) setAccessWorkspaceRoot(selected.trim());
  }, [effectiveWorkspaceRoot, props.workspaceRoot]);

  const addAccessibleWorkspaceRoot = useCallback(async () => {
    setError(null);
    const selected = await pickDirectory({
      title: t("messaging.weixin_access_workspace_extra_pick_title"),
      defaultPath: effectiveWorkspaceRoot || props.workspaceRoot,
    });
    if (typeof selected !== "string" || !selected.trim()) return;
    const root = selected.trim();
    if (root === effectiveWorkspaceRoot || effectiveAccessibleRoots.includes(root)) return;
    const probe = await weixinProbeAccessibleRoot({ root });
    if (!probe.ok) {
      setError(t("messaging.weixin_access_workspace_probe_failed", { error: String(probe.error ?? "unknown error") }));
      return;
    }
    setAccessibleWorkspaceRoots((current) => [...current, root]);
  }, [effectiveAccessibleRoots, effectiveWorkspaceRoot, props.workspaceRoot]);

  const removeAccessibleWorkspaceRoot = useCallback((root: string) => {
    setAccessibleWorkspaceRoots((current) => current.filter((item) => item !== root));
  }, []);

  const saveManualAccount = useCallback(async () => {
    setBusy("save");
    setError(null);
    try {
      const result = await weixinSaveAccount({ accountId: accountId.trim(), token: token.trim(), baseUrl: baseUrl.trim() });
      setAccount((result.account as WeixinAccount | null | undefined) ?? null);
      setToken("");
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(null);
    }
  }, [accountId, baseUrl, refresh, token]);

  const startLogin = useCallback(async () => {
    setBusy("login");
    setError(null);
    setQrStatus("");
    setQrAutoPoll(false);
    setQrPollCount(0);
    setQrLastPollAt(null);
    setQrLastPollBaseUrl("");
    setQrRedirectHost("");
    setQrPollDetail("");
    try {
      const result = await weixinLoginStart({ baseUrl: baseUrl.trim() });
      setQrCode(String(result.qrcode ?? ""));
      setQrCodeUrl(String(result.qrcodeUrl ?? ""));
      setQrImageDataUrl(String(result.qrcodeImageDataUrl ?? ""));
      setQrStatus(String(result.rawStatus ?? "wait"));
      setQrPollBaseUrl(baseUrl.trim());
      setQrAutoPoll(true);
      if (result.qrcodeImageError && !result.qrcodeImageDataUrl) {
        setError(String(result.qrcodeImageError));
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(null);
    }
  }, [baseUrl]);

  const pollLogin = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!qrCode) return;
    if (!options.silent) setBusy("poll");
    setError(null);
    try {
      const currentPollBaseUrl = qrPollBaseUrl || baseUrl.trim();
      const result = await weixinLoginPoll({
        qrcode: qrCode,
        baseUrl: currentPollBaseUrl,
        workspaceRoot: effectiveWorkspaceRoot,
        accessibleWorkspaceRoots: effectiveAccessibleRoots,
        agent: agentPayload,
        availableAgents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          executablePath: agent.executablePath,
          model: agent.model,
          customArgs: agent.customArgs,
        })),
        approvalMode,
        promptMode,
        dmPolicy: allowedUser.trim() ? "allowlist" : "open",
        allowedUsers: allowedUser.trim() ? [allowedUser.trim()] : [],
      });
      const nextStatus = String(result.status ?? "wait");
      setQrPollCount((count) => count + 1);
      setQrLastPollAt(Date.now());
      setQrLastPollBaseUrl(String(result.pollBaseUrl ?? currentPollBaseUrl));
      setQrRedirectHost(String(result.redirectHost ?? ""));
      setQrPollDetail([
        result.ret !== undefined && result.ret !== null ? `ret=${String(result.ret)}` : "",
        result.errcode !== undefined && result.errcode !== null ? `errcode=${String(result.errcode)}` : "",
        result.errmsg ? `errmsg=${String(result.errmsg)}` : "",
      ].filter(Boolean).join(" "));
      setQrStatus(nextStatus);
      if (result.baseUrl) {
        const nextBaseUrl = String(result.baseUrl);
        setQrPollBaseUrl(nextBaseUrl);
        setBaseUrl(nextBaseUrl);
      }
      if (nextStatus === "expired") setQrAutoPoll(false);
      if (result.account) {
        const nextAccount = result.account as WeixinAccount;
        setAccount(nextAccount);
        setAccountId(nextAccount.accountId);
        setToken("");
        setQrAutoPoll(false);
        await refresh();
        if (result.autoStartOk === false) {
          const autoStartError = String((result.autoStart as { error?: unknown })?.error ?? "");
          setError(t("local_agent.weixin_autostart_failed", {
            error: autoStartError || t("local_agent.unknown_error"),
          }));
        }
      }
    } catch (pollError) {
      setError(pollError instanceof Error ? pollError.message : String(pollError));
    } finally {
      if (!options.silent) setBusy(null);
    }
  }, [agentPayload, agents, allowedUser, approvalMode, baseUrl, effectiveAccessibleRoots, effectiveWorkspaceRoot, promptMode, qrCode, qrPollBaseUrl, refresh]);

  useEffect(() => {
    if (!qrAutoPoll || !qrCode) return;
    if (qrStatus === "confirmed" || qrStatus === "expired") return;
    const timer = window.setTimeout(() => void pollLogin({ silent: true }), 1_000);
    return () => window.clearTimeout(timer);
  }, [pollLogin, qrAutoPoll, qrCode, qrStatus, qrPollCount]);

  const startService = useCallback(async () => {
    setBusy("start");
    setError(null);
    try {
      const result = await weixinStart({
        accountId: effectiveAccountId,
        workspaceRoot: effectiveWorkspaceRoot,
        accessibleWorkspaceRoots: effectiveAccessibleRoots,
        agent: agentPayload,
        availableAgents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          executablePath: agent.executablePath,
          model: agent.model,
          customArgs: agent.customArgs,
        })),
        approvalMode,
        promptMode,
        dmPolicy: allowedUser.trim() ? "allowlist" : "open",
        allowedUsers: allowedUser.trim() ? [allowedUser.trim()] : [],
      });
      if (result.status) {
        setServiceState(result.status as WeixinPanelState);
        onStatusChange?.(result.status as WeixinPanelState);
      }
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setBusy(null);
    }
  }, [agentPayload, agents, allowedUser, approvalMode, effectiveAccessibleRoots, effectiveAccountId, effectiveWorkspaceRoot, onStatusChange, promptMode]);

  const applyApprovalMode = useCallback(async (nextMode: PersonalLocalAgentApprovalMode) => {
    setApprovalMode(nextMode);
    if (!running) return;
    setBusy("start");
    setError(null);
    try {
      const result = await weixinStart({
        accountId: effectiveAccountId,
        workspaceRoot: effectiveWorkspaceRoot,
        accessibleWorkspaceRoots: effectiveAccessibleRoots,
        agent: agentPayload,
        availableAgents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          executablePath: agent.executablePath,
          model: agent.model,
          customArgs: agent.customArgs,
        })),
        approvalMode: nextMode,
        promptMode,
        dmPolicy: allowedUser.trim() ? "allowlist" : "open",
        allowedUsers: allowedUser.trim() ? [allowedUser.trim()] : [],
      });
      if (result.status) {
        setServiceState(result.status as WeixinPanelState);
        onStatusChange?.(result.status as WeixinPanelState);
      }
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setBusy(null);
    }
  }, [agentPayload, agents, allowedUser, effectiveAccessibleRoots, effectiveAccountId, effectiveWorkspaceRoot, onStatusChange, promptMode, running]);

  const stopService = useCallback(async () => {
    setBusy("stop");
    setError(null);
    try {
      const result = await weixinStop();
      if (result.status) {
        setServiceState(result.status as WeixinPanelState);
        onStatusChange?.(result.status as WeixinPanelState);
      }
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : String(stopError));
    } finally {
      setBusy(null);
    }
  }, [onStatusChange]);

  const simulateInbound = useCallback(async () => {
    setBusy("simulate");
    setError(null);
    try {
      const result = await weixinSimulateInbound({
        accountId: effectiveAccountId,
        fromUserId: allowedUser.trim(),
        text: simulateText.trim() || "ping",
        workspaceRoot: effectiveWorkspaceRoot,
        accessibleWorkspaceRoots: effectiveAccessibleRoots,
        agent: agentPayload,
        availableAgents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          executablePath: agent.executablePath,
          model: agent.model,
          customArgs: agent.customArgs,
        })),
        dmPolicy: "allowlist",
        allowedUsers: [allowedUser.trim()],
        textBatchDelayMs: 0,
        promptMode,
      });
      if (!result.ok) throw new Error(String(result.error ?? "simulate failed"));
      if (result.status) {
        setServiceState(result.status as WeixinPanelState);
        onStatusChange?.(result.status as WeixinPanelState);
      }
      window.setTimeout(() => void refresh(), 500);
    } catch (simulateError) {
      setError(simulateError instanceof Error ? simulateError.message : String(simulateError));
    } finally {
      setBusy(null);
    }
  }, [agentPayload, agents, allowedUser, effectiveAccessibleRoots, effectiveAccountId, effectiveWorkspaceRoot, onStatusChange, promptMode, refresh, simulateText]);

  const testConnection = useCallback(async () => {
    setBusy("test");
    setError(null);
    setProbeResult(null);
    try {
      const result = await testChannelConnection("weixin", { accountId: effectiveAccountId });
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

  return (
    <div className="space-y-5">
      {/* Runtime summary — single strip, no metric cards */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-dls-secondary">
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
          >
            {busy === "refresh" ? (
              <LoadingSpinner size="default" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
        </div>
        <span className="hidden h-3 w-px bg-dls-border sm:block" aria-hidden />
        <MetricInline
          label={t("messaging.weixin_account")}
          value={account?.accountId || effectiveAccountId || "--"}
        />
        <MetricInline
          label={t("messaging.weixin_last_message")}
          value={shortTime(serviceState.lastMessageAt)}
        />
        <MetricInline
          label={t("messaging.weixin_counts")}
          value={`${serviceState.processedCount ?? 0}/${serviceState.sentCount ?? 0}`}
        />
      </div>

      <PanelSection title={t("messaging.weixin_account")}>
        <div className="grid gap-2 md:grid-cols-3">
          <Input
            value={accountId}
            onChange={(event) => setAccountId(event.currentTarget.value)}
            placeholder="account_id"
          />
          <Input
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            placeholder="token"
            type="password"
          />
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
            placeholder="base_url"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={saveManualAccount}
            disabled={!accountId.trim() || !token.trim() || Boolean(busy)}
          >
            {busy === "save" ? busyIcon : <Save className="size-4" />}
            {t("messaging.weixin_save_account")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startLogin}
            disabled={Boolean(busy)}
          >
            {busy === "login" ? busyIcon : <QrCode className="size-4" />}
            {t("messaging.weixin_qr_login")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={testConnection}
            disabled={!effectiveAccountId || Boolean(busy)}
            title={
              effectiveAccountId
                ? undefined
                : t("messaging.weixin_test_need_account")
            }
          >
            {busy === "test" ? busyIcon : <Plug className="size-4" />}
            {t("messaging.weixin_test_connection")}
          </Button>
        </div>
        {probeResult ? (
          <div className="mt-2">
            {probeResult.ok ? (
              <NoticeBox tone="info" className="break-words leading-5">
                {t("messaging.weixin_test_ok", {
                  username: probeResult.botUsername ?? "",
                })}
              </NoticeBox>
            ) : (
              <NoticeBox tone="error" className="break-words leading-5">
                {probeResult.error ?? t("messaging.weixin_test_failed")}
              </NoticeBox>
            )}
          </div>
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
              <FolderOpen className="size-4" />
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
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-dls-secondary">
              {t("messaging.weixin_access_workspace_extra_title")}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void addAccessibleWorkspaceRoot()}
              disabled={running || Boolean(busy)}
            >
              <FolderOpen className="size-4" />
              {t("messaging.weixin_access_workspace_extra_add")}
            </Button>
          </div>
          {effectiveAccessibleRoots.length ? (
            <div className="flex flex-col gap-1.5">
              {effectiveAccessibleRoots.map((root) => (
                <AccessibleRootRow
                  key={root}
                  root={root}
                  onRemove={removeAccessibleWorkspaceRoot}
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
            <RefreshCw className="size-4" />
            {t("common.refresh")}
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
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
          <FieldLabel
            label={t("messaging.weixin_approval_mode")}
            hint={
              running
                ? t("messaging.weixin_approval_mode_live_desc")
                : t("messaging.weixin_approval_mode_desc")
            }
          >
            <SelectMenu
              size="compact"
              value={approvalMode}
              onChange={(value) =>
                void applyApprovalMode(value as PersonalLocalAgentApprovalMode)
              }
              ariaLabel={t("messaging.weixin_approval_mode")}
              disabled={Boolean(busy) || !selectedAgentSupportsApproval}
              options={APPROVAL_MODE_OPTIONS}
            />
          </FieldLabel>
          <FieldLabel label={t("messaging.weixin_prompt_mode")}>
            <SelectMenu
              size="compact"
              value={promptMode}
              onChange={(value) =>
                setPromptMode(value === "debug" ? "debug" : "raw")
              }
              ariaLabel={t("messaging.weixin_prompt_mode")}
              disabled={running || Boolean(busy)}
              options={PROMPT_MODE_OPTIONS}
            />
          </FieldLabel>
        </div>
        <p className="text-xs leading-5 text-dls-secondary">
          {t("messaging.weixin_agent_command_help_prefix")}{" "}
          <span className="font-mono text-dls-text">#agent</span>{" "}
          {t("messaging.weixin_agent_command_help_middle")}{" "}
          <span className="font-mono text-dls-text">#agent codex</span>{" "}
          {t("messaging.weixin_agent_command_help_suffix")}
        </p>
      </PanelSection>

      <PanelSection title={t("messaging.weixin_start")}>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={startService}
            disabled={!canStart || Boolean(busy)}
          >
            {busy === "start" ? busyIcon : <Play className="size-4" />}
            {t("messaging.weixin_start")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={stopService}
            disabled={!running || Boolean(busy)}
          >
            {busy === "stop" ? busyIcon : <Square className="size-4" />}
            {t("messaging.weixin_stop")}
          </Button>
        </div>
      </PanelSection>

      {serviceState.lastError || error ? (
        <NoticeBox tone="error" className="break-words leading-5">
          {serviceState.lastError || error}
        </NoticeBox>
      ) : null}

      {qrCode || qrCodeUrl ? (
        <PanelSection
          title={t("messaging.weixin_qr_status", { status: qrStatus || "wait" })}
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void pollLogin()}
              disabled={!qrCode || Boolean(busy)}
            >
              {busy === "poll" ? busyIcon : <RefreshCw className="size-4" />}
              {t("messaging.weixin_poll_login")}
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {qrImageUrl ? (
              <div className="flex size-60 items-center justify-center rounded-lg border border-dls-border bg-dls-surface p-3">
                {/* QR needs a white plate for scan reliability; keep it local to the image. */}
                <div className="rounded-md bg-white p-2">
                  <img
                    src={qrImageUrl}
                    alt={t("messaging.weixin_qr_alt")}
                    className="size-52"
                    draggable={false}
                  />
                </div>
              </div>
            ) : qrScanValue ? (
              <div className="flex size-60 items-center justify-center rounded-lg border border-dls-border bg-dls-surface-muted p-3 text-center text-xs text-dls-secondary">
                {t("messaging.weixin_qr_render_failed")}
              </div>
            ) : null}
            <div className="min-w-0 space-y-2">
              <MonoLogBox>{qrScanValue}</MonoLogBox>
              <MonoLogBox density="stacked">
                <div>
                  {t("messaging.weixin_qr_poll_count", { count: qrPollCount })}
                </div>
                <div>
                  {t("messaging.weixin_qr_last_poll", {
                    time: shortTime(qrLastPollAt),
                  })}
                </div>
                <div className="break-all">
                  baseUrl: {qrLastPollBaseUrl || qrPollBaseUrl || baseUrl}
                </div>
                {qrRedirectHost ? (
                  <div className="break-all">redirectHost: {qrRedirectHost}</div>
                ) : null}
                {qrPollDetail ? (
                  <div className="break-all">{qrPollDetail}</div>
                ) : null}
              </MonoLogBox>
              {qrImageUrl || qrCodeUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void openDesktopUrl(qrImageUrl || qrCodeUrl)}
                >
                  <ExternalLink className="size-4" />
                  {t("messaging.weixin_open_qr")}
                </Button>
              ) : null}
            </div>
          </div>
        </PanelSection>
      ) : null}
    </div>
  );
}

function MetricInline(props: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      <span className="shrink-0">{props.label}</span>
      <span className="truncate font-medium text-dls-text">{props.value}</span>
    </span>
  );
}
