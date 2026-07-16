import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, FolderOpen, Play, Plug, RefreshCw, Save, Send, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { SelectMenu } from "../../design-system/select-menu";
import { AccessibleRootRow } from "../../design-system/accessible-root-row";
import { t } from "../../../i18n";
import {
  openDesktopUrl,
  personalLocalAgentsList,
  pickDirectory,
  type DiscordAccountStatus,
  type DiscordServiceStartInput,
  type DiscordSimulateInboundInput,
  type MessagingChannelStatus,
  type PersonalLocalAgent,
  type PersonalLocalAgentApprovalMode,
  type TelegramAccountStatus,
  type TelegramServiceStartInput,
  type TelegramSimulateInboundInput,
  discordAccountStatus,
  discordSaveAccount,
  discordSimulateInbound,
  discordStart,
  discordStatus,
  discordStop,
  telegramAccountStatus,
  telegramSaveAccount,
  telegramSimulateInbound,
  telegramStart,
  telegramStatus,
  telegramStop,
  onChannelStatus,
  testChannelConnection,
  type ChannelProbeResult,
} from "../../../app/lib/desktop";

type TokenChannelKind = "telegram" | "discord";

type TokenPanelState = {
  status?: string;
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  approvalMode?: PersonalLocalAgentApprovalMode;
  botUsername?: string;
  lastError?: string | null;
  lastMessageAt?: number | null;
  processedCount?: number;
  sentCount?: number;
};

type TokenAccount = {
  accountId: string;
  botUsername?: string;
  hasToken?: boolean;
  [key: string]: unknown;
};

type TokenAccountStatusPayload = {
  ok?: boolean;
  account?: TokenAccount | null;
  status?: MessagingChannelStatus;
  config?: Record<string, unknown>;
  error?: string;
};

type BusyAction = "refresh" | "save" | "start" | "stop" | "simulate" | "test" | null;
type TokenPromptMode = "raw" | "debug";

const APPROVAL_MODE_OPTIONS: Array<{ value: PersonalLocalAgentApprovalMode; label: string }> = [
  { value: "ask", label: t("local_agent.approval_ask") },
  { value: "auto", label: t("local_agent.approval_auto") },
  { value: "read-only-auto", label: t("local_agent.approval_readonly_auto") },
];

const PROMPT_MODE_OPTIONS: Array<{ value: TokenPromptMode; label: string }> = [
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

type KindConfig = {
  titleKey: string;
  descKey: string;
  tokenLabelKey: string;
  tokenPlaceholderKey: string;
  saveKey: string;
  startKey: string;
  stopKey: string;
  simulateKey: string;
  simulatePlaceholderKey: string;
  helpLinkKey: string;
  helpLinkUrl: string;
  agentHelpKey: string;
  needsAllowedUsers: boolean;
  allowedUsersLabelKey?: string;
  allowedUsersPlaceholderKey?: string;
};

const KIND_CONFIG: Record<TokenChannelKind, KindConfig> = {
  telegram: {
    titleKey: "messaging.telegram_native_title",
    descKey: "messaging.telegram_native_desc",
    tokenLabelKey: "messaging.telegram_bot_token",
    tokenPlaceholderKey: "messaging.telegram_bot_token_placeholder",
    saveKey: "messaging.telegram_save_account",
    startKey: "messaging.telegram_start",
    stopKey: "messaging.telegram_stop",
    simulateKey: "messaging.telegram_simulate",
    simulatePlaceholderKey: "messaging.telegram_simulate_placeholder",
    helpLinkKey: "messaging.telegram_help_link",
    helpLinkUrl: "https://core.telegram.org/bots#botfather",
    agentHelpKey: "messaging.telegram_agent_command_help",
    needsAllowedUsers: false,
  },
  discord: {
    titleKey: "messaging.discord_native_title",
    descKey: "messaging.discord_native_desc",
    tokenLabelKey: "messaging.discord_bot_token",
    tokenPlaceholderKey: "messaging.discord_bot_token_placeholder",
    saveKey: "messaging.discord_save_account",
    startKey: "messaging.discord_start",
    stopKey: "messaging.discord_stop",
    simulateKey: "messaging.discord_simulate",
    simulatePlaceholderKey: "messaging.discord_simulate_placeholder",
    helpLinkKey: "messaging.discord_help_link",
    helpLinkUrl: "https://discord.com/developers/applications",
    agentHelpKey: "messaging.discord_agent_command_help",
    needsAllowedUsers: true,
    allowedUsersLabelKey: "messaging.discord_allowed_users",
    allowedUsersPlaceholderKey: "messaging.discord_allowed_users_placeholder",
  },
};

function parseAllowedUsers(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

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
  };
}

function PanelSection(props: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-dls-border bg-dls-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-dls-text">{props.title}</div>
          {props.description ? (
            <div className="mt-1 text-xs leading-5 text-dls-secondary">{props.description}</div>
          ) : null}
        </div>
        {props.actions ? <div className="flex shrink-0 flex-wrap gap-2">{props.actions}</div> : null}
      </div>
      <div className="mt-3">{props.children}</div>
    </section>
  );
}

function FieldLabel(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="min-w-0 text-xs text-dls-secondary">
      <span className="mb-1 block">{props.label}</span>
      {props.children}
      {props.hint ? <span className="mt-1 block text-xs leading-4 text-dls-muted">{props.hint}</span> : null}
    </label>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-dls-border bg-dls-card px-3 py-2">
      <div className="text-xs text-dls-secondary">{props.label}</div>
      <div className="mt-1 truncate text-sm font-medium text-dls-text">{props.value}</div>
    </div>
  );
}

export function TokenChannelPanel(props: {
  kind: TokenChannelKind;
  workspaceRoot?: string;
  onStatusChange?: (status: MessagingChannelStatus) => void;
}) {
  const { kind, onStatusChange } = props;
  const cfg = KIND_CONFIG[kind];
  const [account, setAccount] = useState<TokenAccount | null>(null);
  const [serviceState, setServiceState] = useState<TokenPanelState>({ status: "stopped" });
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<ChannelProbeResult | null>(null);
  const [accountId, setAccountId] = useState("default");
  const [token, setToken] = useState("");
  const [allowedUsers, setAllowedUsers] = useState("");
  const [accessWorkspaceRoot, setAccessWorkspaceRoot] = useState("");
  const [accessibleWorkspaceRoots, setAccessibleWorkspaceRoots] = useState<string[]>([]);
  const [simulateText, setSimulateText] = useState("ping");
  const [agents, setAgents] = useState<PersonalLocalAgent[]>([FALLBACK_AGENT]);
  const [selectedAgentId, setSelectedAgentId] = useState("opencode");
  const [approvalMode, setApprovalMode] = useState<PersonalLocalAgentApprovalMode>("ask");
  const [promptMode, setPromptMode] = useState<TokenPromptMode>("raw");

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
  const busyIcon = useMemo(() => (busy ? <LoadingSpinner size="default" /> : null), [busy]);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? FALLBACK_AGENT;
  const selectedAgentSupportsApproval = selectedAgent.capability?.supportsApproval !== false;
  const selectedAgentPayload = useMemo(() => agentPayload(selectedAgent), [selectedAgent]);
  const agentsPayload = useMemo(() => agents.map(agentPayload), [agents]);

  const applyServiceState = useCallback((nextState: TokenPanelState) => {
    setServiceState(nextState);
    onStatusChange?.(nextState as MessagingChannelStatus);
  }, [onStatusChange]);

  const refreshAgents = useCallback(async () => {
    try {
      const result = await personalLocalAgentsList({ workspaceRoot: effectiveWorkspaceRoot, includeModels: false });
      const nextAgents = result.agents.length ? result.agents : [FALLBACK_AGENT];
      setAgents(nextAgents);
      setSelectedAgentId((current) => (nextAgents.some((agent) => agent.id === current) ? current : nextAgents[0]?.id ?? "opencode"));
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
        kind === "telegram"
          ? telegramAccountStatus(effectiveAccountId ? { accountId: effectiveAccountId } : {})
          : discordAccountStatus(effectiveAccountId ? { accountId: effectiveAccountId } : {}),
        kind === "telegram" ? telegramStatus() : discordStatus(),
      ]);
      const accountPayload = accountResult as TokenAccountStatusPayload;
      const nextAccount = accountPayload.account ?? null;
      setAccount(nextAccount);
      if (nextAccount?.accountId) setAccountId(nextAccount.accountId);
      if (nextAccount?.botUsername) setAccount((current) => ({ ...(current ?? { accountId: nextAccount.accountId }), botUsername: nextAccount.botUsername }));
      const storedWorkspaceRoot = String((accountPayload.config?.workspaceRoot as string | undefined) ?? (accountPayload.status?.workspaceRoot as string | undefined) ?? "").trim();
      if (storedWorkspaceRoot) setAccessWorkspaceRoot((current) => (current.trim() ? current : storedWorkspaceRoot));
      const storedAccessibleRoots = (accountPayload.config?.accessibleWorkspaceRoots as string[] | undefined)
        ?? (accountPayload.status?.accessibleWorkspaceRoots as string[] | undefined)
        ?? [];
      if (storedAccessibleRoots.length) setAccessibleWorkspaceRoots((current) => (current.length ? current : storedAccessibleRoots));
      const storedApprovalMode = (accountPayload.config?.approvalMode as PersonalLocalAgentApprovalMode | undefined)
        ?? (accountPayload.status?.approvalMode as PersonalLocalAgentApprovalMode | undefined);
      if (storedApprovalMode === "auto" || storedApprovalMode === "ask" || storedApprovalMode === "read-only-auto") {
        setApprovalMode(storedApprovalMode);
      }
      const storedAllowed = (accountPayload.config?.allowedUserIds as string[] | undefined)
        ?? (accountPayload.status?.allowedUserIds as string[] | undefined);
      if (storedAllowed && storedAllowed.length) setAllowedUsers(storedAllowed.join(", "));
      applyServiceState(statusResult as TokenPanelState);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy(null);
    }
  }, [applyServiceState, effectiveAccountId, kind]);

  useEffect(() => {
    void (async () => {
      const accountResult = (kind === "telegram" ? await telegramAccountStatus({}).catch(() => null) : await discordAccountStatus({}).catch(() => null)) as TokenAccountStatusPayload | null;
      const storedWorkspaceRoot = String(accountResult?.config?.workspaceRoot ?? accountResult?.status?.workspaceRoot ?? "").trim();
      const storedAccessibleRoots = (accountResult?.config?.accessibleWorkspaceRoots as string[] | undefined)
        ?? (accountResult?.status?.accessibleWorkspaceRoots as string[] | undefined)
        ?? [];
      if (storedWorkspaceRoot) setAccessWorkspaceRoot(storedWorkspaceRoot);
      if (storedAccessibleRoots.length) setAccessibleWorkspaceRoots(storedAccessibleRoots);
      const storedAllowed = (accountResult?.config?.allowedUserIds as string[] | undefined)
        ?? (accountResult?.status?.allowedUserIds as string[] | undefined);
      if (storedAllowed && storedAllowed.length) setAllowedUsers(storedAllowed.join(", "));
      await refresh();
    })();
  }, [kind, refresh]);

  // While the channel is running, subscribe to backend status pushes instead
  // of polling. The electron main process forwards channel state-change events
  // (parity: AionUi event-push for pluginStatusChanged) so the UI updates the
  // moment processed/sent counts or lastError change — no more silent "no
  // response" after sending a message.
  useEffect(() => {
    if (!running) return;
    const unsubscribe = onChannelStatus((payload) => {
      if (payload.platformType !== kind) return;
      applyServiceState(payload.status as TokenPanelState);
    });
    return unsubscribe;
  }, [running, kind, applyServiceState]);

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
    if (root) setAccessibleWorkspaceRoots((current) => [...current, root]);
  }, [effectiveAccessibleRoots, effectiveWorkspaceRoot, props.workspaceRoot]);

  const saveManualAccount = useCallback(async () => {
    setBusy("save");
    setError(null);
    try {
      const input = kind === "discord"
        ? { accountId: accountId.trim(), token: token.trim(), allowedUserIds: parseAllowedUsers(allowedUsers) }
        : { accountId: accountId.trim(), token: token.trim() };
      const result = kind === "telegram"
        ? await telegramSaveAccount(input)
        : await discordSaveAccount(input);
      const typedSave = result as { ok?: boolean; account?: TokenAccount | null; error?: unknown };
      if (typedSave.ok === false) {
        setError(typedSave.error != null ? String(typedSave.error) : "save account failed");
        return;
      }
      const nextAccount = typedSave.account ?? null;
      setAccount(nextAccount);
      setToken("");
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(null);
    }
  }, [accountId, allowedUsers, kind, refresh, token]);

  const startService = useCallback(async () => {
    setBusy("start");
    setError(null);
    try {
      const input: TelegramServiceStartInput | DiscordServiceStartInput = {
        accountId: effectiveAccountId,
        workspaceRoot: effectiveWorkspaceRoot,
        accessibleWorkspaceRoots: effectiveAccessibleRoots,
        agent: selectedAgentPayload,
        availableAgents: agentsPayload,
        approvalMode,
        promptMode,
        dmPolicy: allowedUsers.trim() ? "allowlist" : "open",
        allowedUsers: parseAllowedUsers(allowedUsers),
        allowedUserIds: parseAllowedUsers(allowedUsers),
      };
      const result = kind === "telegram"
        ? await telegramStart(input as TelegramServiceStartInput)
        : await discordStart(input as DiscordServiceStartInput);
      const typedStart = result as { ok?: boolean; status?: TokenPanelState; error?: unknown };
      if (typedStart.ok === false) {
        setError(typedStart.error != null ? String(typedStart.error) : "start failed");
        return;
      }
      if (typedStart.status) applyServiceState(typedStart.status);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setBusy(null);
    }
  }, [agentsPayload, allowedUsers, applyServiceState, approvalMode, effectiveAccessibleRoots, effectiveAccountId, effectiveWorkspaceRoot, kind, promptMode, refresh, selectedAgentPayload]);

  const applyApprovalMode = useCallback(async (nextMode: PersonalLocalAgentApprovalMode) => {
    setApprovalMode(nextMode);
    if (!running) return;
    await startService();
  }, [running, startService]);

  const stopService = useCallback(async () => {
    setBusy("stop");
    setError(null);
    try {
      const result = kind === "telegram" ? await telegramStop() : await discordStop();
      if (result.status) applyServiceState(result.status as TokenPanelState);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : String(stopError));
    } finally {
      setBusy(null);
    }
  }, [applyServiceState, kind]);

  const simulateInbound = useCallback(async () => {
    setBusy("simulate");
    setError(null);
    try {
      const input: TelegramSimulateInboundInput | DiscordSimulateInboundInput = {
        accountId: effectiveAccountId,
        fromUserId: allowedUsers.trim() || "studio_test_user",
        chatId: kind === "discord" ? "discord_studio_test_chat" : "tg_studio_test_chat",
        text: simulateText.trim() || "ping",
        workspaceRoot: effectiveWorkspaceRoot,
        accessibleWorkspaceRoots: effectiveAccessibleRoots,
        agent: selectedAgentPayload,
        availableAgents: agentsPayload,
        approvalMode,
        promptMode,
        dmPolicy: "open",
        allowedUsers: parseAllowedUsers(allowedUsers),
        textBatchDelayMs: 0,
      };
      const result = kind === "telegram"
        ? await telegramSimulateInbound(input as TelegramSimulateInboundInput)
        : await discordSimulateInbound(input as DiscordSimulateInboundInput);
      if (!result.ok) throw new Error(String((result as { error?: unknown }).error ?? "simulate failed"));
      if (result.status) applyServiceState(result.status as TokenPanelState);
      void refresh();
    } catch (simulateError) {
      setError(simulateError instanceof Error ? simulateError.message : String(simulateError));
    } finally {
      setBusy(null);
    }
  }, [agentsPayload, allowedUsers, applyServiceState, effectiveAccessibleRoots, effectiveAccountId, effectiveWorkspaceRoot, kind, promptMode, refresh, selectedAgentPayload, simulateText]);

  const testConnection = useCallback(async () => {
    setBusy("test");
    setError(null);
    setProbeResult(null);
    try {
      const result = await testChannelConnection(kind, { accountId: effectiveAccountId });
      if (!result.ok) throw new Error(result.error ?? "connection test failed");
      setProbeResult(result);
    } catch (probeError) {
      const message = probeError instanceof Error ? probeError.message : String(probeError);
      setProbeResult({ ok: false, error: message });
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [effectiveAccountId, kind]);

  const canStart = Boolean(effectiveAccountId && effectiveWorkspaceRoot) && !running;
  const canSave = Boolean(accountId.trim() && token.trim()) && !busy;

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-dls-border bg-dls-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-dls-text">{t(cfg.titleKey)}</div>
          <div className="mt-1 text-xs leading-5 text-dls-secondary">{t(cfg.descKey)}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={statusTone(serviceState.status)}>{serviceState.status ?? "stopped"}</StatusBadge>
          <Button type="button" variant="ghost" size="icon-sm" onClick={refresh} disabled={Boolean(busy)} aria-label={t("common.refresh")}>
            {busy === "refresh" ? <LoadingSpinner size="default" /> : <RefreshCw className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label={t(cfg.tokenLabelKey)} value={account?.accountId || effectiveAccountId || "--"} />
        <Metric label={t("messaging.weixin_access_workspace_metric")} value={effectiveWorkspaceRoot || "--"} />
        <Metric label={t("messaging.weixin_last_message")} value={shortTime(serviceState.lastMessageAt)} />
        <Metric label={t("messaging.weixin_counts")} value={`${serviceState.processedCount ?? 0}/${serviceState.sentCount ?? 0}`} />
      </div>

      <PanelSection
        title={t("messaging.weixin_access_workspace_title")}
        description={t("messaging.weixin_access_workspace_desc")}
        actions={(
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void chooseAccessWorkspace()} disabled={running || Boolean(busy)}>
              <FolderOpen className="size-4" />
              {t("messaging.weixin_access_workspace_pick")}
            </Button>
            {props.workspaceRoot ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAccessWorkspaceRoot(props.workspaceRoot ?? "")} disabled={running || Boolean(busy)}>
                {t("messaging.weixin_access_workspace_use_current")}
              </Button>
            ) : null}
          </>
        )}
      >
        <Input
          className="font-mono text-xs"
          value={effectiveWorkspaceRoot}
          onChange={(event) => setAccessWorkspaceRoot(event.currentTarget.value)}
          placeholder={t("messaging.weixin_access_workspace_placeholder")}
          disabled={running || Boolean(busy)}
        />
        <div className="mt-3 border-t border-dls-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-dls-text">{t("messaging.weixin_access_workspace_extra_title")}</div>
              <div className="mt-1 text-xs leading-5 text-dls-secondary">{t("messaging.weixin_access_workspace_extra_desc")}</div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void addAccessibleWorkspaceRoot()} disabled={running || Boolean(busy)}>
              <FolderOpen className="size-4" />
              {t("messaging.weixin_access_workspace_extra_add")}
            </Button>
          </div>
          {effectiveAccessibleRoots.length ? (
            <div className="mt-2 flex flex-col gap-2">
              {effectiveAccessibleRoots.map((root) => (
                <AccessibleRootRow
                  key={root}
                  root={root}
                  onRemove={(target) => setAccessibleWorkspaceRoots((current) => current.filter((item) => item !== target))}
                  disabled={running || Boolean(busy)}
                  removeLabel={t("messaging.weixin_access_workspace_extra_remove")}
                />
              ))}
            </div>
          ) : (
            <NoticeBox tone="neutral" className="mt-2">
              {t("messaging.weixin_access_workspace_extra_empty")}
            </NoticeBox>
          )}
        </div>
      </PanelSection>

      <PanelSection title={t(cfg.tokenLabelKey)} description={t(cfg.descKey)}>
        <div className="grid gap-3 md:grid-cols-2">
          <Input value={accountId} onChange={(event) => setAccountId(event.currentTarget.value)} placeholder="account_id" />
          <Input value={token} onChange={(event) => setToken(event.currentTarget.value)} placeholder={t(cfg.tokenPlaceholderKey)} type="password" />
        </div>
        {cfg.needsAllowedUsers ? (
          <div className="mt-3">
            <FieldLabel label={t(cfg.allowedUsersLabelKey ?? "")}>
              <Textarea
                className="font-mono text-xs"
                value={allowedUsers}
                onChange={(event) => setAllowedUsers(event.currentTarget.value)}
                placeholder={t(cfg.allowedUsersPlaceholderKey ?? "")}
                rows={2}
                disabled={running || Boolean(busy)}
              />
            </FieldLabel>
          </div>
        ) : null}
      </PanelSection>

      <PanelSection
        title={t("identities.message_routing_title")}
        description={t("messaging.configure_agent_desc")}
        actions={(
          <Button type="button" variant="ghost" size="sm" onClick={() => void refreshAgents()} disabled={running || Boolean(busy)}>
            <RefreshCw className="size-4" />
            {t("common.refresh")}
          </Button>
        )}
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
      </PanelSection>

      <PanelSection title={t("status.running")} description={t("identities.message_routing_desc")}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={saveManualAccount} disabled={!canSave}>
            {busy === "save" ? busyIcon : <Save className="size-4" />}
            {t(cfg.saveKey)}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={startService} disabled={!canStart || Boolean(busy)}>
            {busy === "start" ? busyIcon : <Play className="size-4" />}
            {t(cfg.startKey)}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={stopService} disabled={!running || Boolean(busy)}>
            {busy === "stop" ? busyIcon : <Square className="size-4" />}
            {t(cfg.stopKey)}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={simulateInbound} disabled={Boolean(busy)}>
            {busy === "simulate" ? busyIcon : <Send className="size-4" />}
            {t(cfg.simulateKey)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={testConnection}
            disabled={!effectiveAccountId || Boolean(busy)}
            title={effectiveAccountId ? undefined : t("messaging.weixin_test_need_account")}
          >
            {busy === "test" ? busyIcon : <Plug className="size-4" />}
            {t("messaging.weixin_test_connection")}
          </Button>
        </div>
        {probeResult ? (
          <div className="mt-2">
            {probeResult.ok ? (
              <NoticeBox tone="info" className="break-words leading-5">
                {t("messaging.weixin_test_ok", { username: probeResult.botUsername ?? "" })}
              </NoticeBox>
            ) : (
              <NoticeBox tone="error" className="break-words leading-5">
                {probeResult.error ?? t("messaging.weixin_test_failed")}
              </NoticeBox>
            )}
          </div>
        ) : null}
      </PanelSection>

      {serviceState.lastError || error ? (
        <NoticeBox tone="error" className="break-words leading-5">
          {serviceState.lastError || error}
        </NoticeBox>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => void openDesktopUrl(cfg.helpLinkUrl)}>
          <ExternalLink className="size-4" />
          {t(cfg.helpLinkKey)}
        </Button>
      </div>

      {/* Agent switch tip */}
      <div className="rounded-lg border border-dls-border bg-dls-muted px-3 py-2 text-xs leading-5 text-dls-secondary">
        {t(cfg.agentHelpKey)}
      </div>
    </div>
  );
}
