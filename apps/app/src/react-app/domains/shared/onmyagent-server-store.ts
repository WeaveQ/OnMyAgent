import { useSyncExternalStore } from "react";

import { t } from "../../../i18n";
import type { StartupPreference, WorkspaceDisplay } from "../../../app/types";
import { isDesktopRuntime } from "../../../app/utils";
import {
  onmyagentServerInfo,
  onmyagentServerRestart,
  type OnMyAgentServerInfo,
} from "../../../app/lib/desktop";
import {
  clearOnMyAgentServerSettings,
  createOnMyAgentServerClient,
  isLoopbackOnMyAgentServerUrl,
  normalizeOnMyAgentServerUrl,
  readOnMyAgentServerSettings,
  writeOnMyAgentServerSettings,
  type OnMyAgentAuditEntry,
  type OnMyAgentServerCapabilities,
  type OnMyAgentServerClient,
  type OnMyAgentServerDiagnostics,
  type OnMyAgentServerError,
  type OnMyAgentServerSettings,
  type OnMyAgentServerStatus,
} from "../../../app/lib/onmyagent-server";

type SetStateAction<T> = T | ((current: T) => T);

type RemoteWorkspaceInput = {
  onmyagentHostUrl: string;
  onmyagentToken?: string | null;
  directory?: string | null;
  displayName?: string | null;
};

export type OnMyAgentServerStoreSnapshot = {
  onmyagentServerSettings: OnMyAgentServerSettings;
  shareRemoteAccessBusy: boolean;
  shareRemoteAccessError: string | null;
  onmyagentServerUrl: string;
  onmyagentServerBaseUrl: string;
  onmyagentServerAuth: { token?: string; hostToken?: string };
  onmyagentServerClient: OnMyAgentServerClient | null;
  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
  onmyagentServerReady: boolean;
  onmyagentServerWorkspaceReady: boolean;
  resolvedOnMyAgentCapabilities: OnMyAgentServerCapabilities | null;
  onmyagentServerCanWriteSkills: boolean;
  onmyagentServerCanWritePlugins: boolean;
  onmyagentServerHostInfo: OnMyAgentServerInfo | null;
  onmyagentServerDiagnostics: OnMyAgentServerDiagnostics | null;
  onmyagentReconnectBusy: boolean;
  onmyagentAuditEntries: OnMyAgentAuditEntry[];
  onmyagentAuditStatus: "idle" | "loading" | "error";
  onmyagentAuditError: string | null;
  devtoolsWorkspaceId: string | null;
};

export type OnMyAgentServerStore = ReturnType<typeof createOnMyAgentServerStore>;

type CreateOnMyAgentServerStoreOptions = {
  startupPreference: () => StartupPreference | null;
  documentVisible: () => boolean;
  developerMode: () => boolean;
  runtimeWorkspaceId: () => string | null;
  activeClient: () => unknown | null;
  selectedWorkspaceDisplay: () => WorkspaceDisplay;
  restartLocalServer: () => Promise<boolean>;
  createRemoteWorkspaceFlow: (input: RemoteWorkspaceInput) => Promise<boolean>;
};

type MutableState = {
  onmyagentServerSettings: OnMyAgentServerSettings;
  shareRemoteAccessBusy: boolean;
  shareRemoteAccessError: string | null;
  onmyagentServerUrl: string;
  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
  onmyagentServerCheckedAt: number | null;
  onmyagentServerHostInfo: OnMyAgentServerInfo | null;
  onmyagentServerHostInfoReady: boolean;
  onmyagentServerDiagnostics: OnMyAgentServerDiagnostics | null;
  onmyagentReconnectBusy: boolean;
  onmyagentAuditEntries: OnMyAgentAuditEntry[];
  onmyagentAuditStatus: "idle" | "loading" | "error";
  onmyagentAuditError: string | null;
  devtoolsWorkspaceId: string | null;
};

const applyStateAction = <T,>(current: T, next: SetStateAction<T>) =>
  typeof next === "function" ? (next as (value: T) => T)(current) : next;

export function createOnMyAgentServerStore(options: CreateOnMyAgentServerStoreOptions) {
  const bootStartedAt = Date.now();
  const listeners = new Set<() => void>();
  const intervals = new Map<string, number>();

  let clientCacheKey = "";
  let clientCacheValue: OnMyAgentServerClient | null = null;
  let started = false;
  let disposed = false;
  let healthTimeoutId: number | null = null;
  let healthBusy = false;
  let healthDelayMs = 10_000;
  let consecutiveHealthFailures = 0;
  let visibilityChangeHandler: (() => void) | null = null;
  let snapshot: OnMyAgentServerStoreSnapshot;

  let state: MutableState = {
    onmyagentServerSettings: readOnMyAgentServerSettings(),
    shareRemoteAccessBusy: false,
    shareRemoteAccessError: null,
    onmyagentServerUrl: "",
    onmyagentServerStatus: "disconnected",
    onmyagentServerCapabilities: null,
    onmyagentServerCheckedAt: null,
    onmyagentServerHostInfo: null,
    onmyagentServerHostInfoReady: !isDesktopRuntime(),
    onmyagentServerDiagnostics: null,
    onmyagentReconnectBusy: false,
    onmyagentAuditEntries: [],
    onmyagentAuditStatus: "idle",
    onmyagentAuditError: null,
    devtoolsWorkspaceId: null,
  };

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getBaseUrl = () => {
    const pref = options.startupPreference();
    const hostInfo = state.onmyagentServerHostInfo;
    const settingsUrl = normalizeOnMyAgentServerUrl(state.onmyagentServerSettings.urlOverride ?? "") ?? "";

    if (pref === "local") return hostInfo?.baseUrl ?? "";
    if (pref === "server" && settingsUrl && isLoopbackOnMyAgentServerUrl(settingsUrl) && hostInfo?.baseUrl) {
      return hostInfo.baseUrl;
    }
    if (pref === "server") return settingsUrl;
    return hostInfo?.baseUrl ?? settingsUrl;
  };

  const getAuth = () => {
    const pref = options.startupPreference();
    const hostInfo = state.onmyagentServerHostInfo;
    const settingsUrl = normalizeOnMyAgentServerUrl(state.onmyagentServerSettings.urlOverride ?? "") ?? "";
    const settingsToken = state.onmyagentServerSettings.token?.trim() ?? "";
    const settingsHostToken = state.onmyagentServerSettings.hostToken?.trim() ?? "";
    const clientToken = hostInfo?.clientToken?.trim() ?? "";
    const hostToken = hostInfo?.hostToken?.trim() ?? "";

    if (pref === "local") {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    if (pref === "server" && settingsUrl && isLoopbackOnMyAgentServerUrl(settingsUrl) && hostInfo?.baseUrl) {
      return {
        token: clientToken || settingsToken || undefined,
        hostToken: hostToken || settingsHostToken || undefined,
      };
    }
    if (pref === "server") {
      return {
        token: settingsToken || undefined,
        hostToken: settingsUrl && isLoopbackOnMyAgentServerUrl(settingsUrl) ? settingsHostToken || undefined : undefined,
      };
    }
    if (hostInfo?.baseUrl) {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    return {
      token: settingsToken || undefined,
      hostToken: settingsUrl && isLoopbackOnMyAgentServerUrl(settingsUrl) ? settingsHostToken || undefined : undefined,
    };
  };

  const getClient = () => {
    const baseUrl = getBaseUrl().trim();
    if (!baseUrl) {
      clientCacheKey = "";
      clientCacheValue = null;
      return null;
    }

    const auth = getAuth();
    const key = `${baseUrl}::${auth.token ?? ""}::${auth.hostToken ?? ""}`;
    if (key !== clientCacheKey) {
      clientCacheKey = key;
      clientCacheValue = createOnMyAgentServerClient({
        baseUrl,
        token: auth.token,
        hostToken: auth.hostToken,
      });
    }
    return clientCacheValue;
  };

  const refreshSnapshot = () => {
    const onmyagentServerBaseUrl = getBaseUrl().trim();
    const onmyagentServerAuth = getAuth();
    const onmyagentServerClient = getClient();
    const onmyagentServerReady = state.onmyagentServerStatus === "connected";
    const onmyagentServerWorkspaceReady = Boolean(options.runtimeWorkspaceId());
    const resolvedOnMyAgentCapabilities = state.onmyagentServerCapabilities;

    const pref = options.startupPreference();
    const info = state.onmyagentServerHostInfo;
    const hostUrl = info?.connectUrl ?? info?.lanUrl ?? info?.mdnsUrl ?? info?.baseUrl ?? "";
    const settingsUrl = normalizeOnMyAgentServerUrl(state.onmyagentServerSettings.urlOverride ?? "") ?? "";

    let onmyagentServerUrl = hostUrl || settingsUrl;
    if (pref === "local") onmyagentServerUrl = hostUrl;
    if (pref === "server") onmyagentServerUrl = settingsUrl;
    state.onmyagentServerUrl = onmyagentServerUrl;

    snapshot = {
      onmyagentServerSettings: state.onmyagentServerSettings,
      shareRemoteAccessBusy: state.shareRemoteAccessBusy,
      shareRemoteAccessError: state.shareRemoteAccessError,
      onmyagentServerUrl,
      onmyagentServerBaseUrl,
      onmyagentServerAuth,
      onmyagentServerClient,
      onmyagentServerStatus: state.onmyagentServerStatus,
      onmyagentServerCapabilities: state.onmyagentServerCapabilities,
      onmyagentServerReady,
      onmyagentServerWorkspaceReady,
      resolvedOnMyAgentCapabilities,
      onmyagentServerCanWriteSkills:
        onmyagentServerReady &&
        (resolvedOnMyAgentCapabilities?.skills?.write ?? false),
      onmyagentServerCanWritePlugins:
        onmyagentServerReady &&
        (resolvedOnMyAgentCapabilities?.plugins?.write ?? false),
      onmyagentServerHostInfo: state.onmyagentServerHostInfo,
      onmyagentServerDiagnostics: state.onmyagentServerDiagnostics,
      onmyagentReconnectBusy: state.onmyagentReconnectBusy,
      onmyagentAuditEntries: state.onmyagentAuditEntries,
      onmyagentAuditStatus: state.onmyagentAuditStatus,
      onmyagentAuditError: state.onmyagentAuditError,
      devtoolsWorkspaceId: state.devtoolsWorkspaceId,
    };
  };

  const mutateState = (updater: (current: MutableState) => MutableState) => {
    state = updater(state);
    refreshSnapshot();
    emitChange();
  };

  const setStateField = <K extends keyof MutableState>(key: K, value: MutableState[K]) => {
    if (Object.is(state[key], value)) return;
    mutateState((current) => ({ ...current, [key]: value }));
  };

  const setOnMyAgentServerSettings = (next: SetStateAction<OnMyAgentServerSettings>) => {
    const resolved = applyStateAction(state.onmyagentServerSettings, next);
    mutateState((current) => ({ ...current, onmyagentServerSettings: resolved }));
    queueHealthCheck(0);
  };

  const updateOnMyAgentServerSettings = (next: OnMyAgentServerSettings) => {
    const stored = writeOnMyAgentServerSettings(next);
    mutateState((current) => ({ ...current, onmyagentServerSettings: stored }));
    queueHealthCheck(0);
  };

  const resetOnMyAgentServerSettings = () => {
    clearOnMyAgentServerSettings();
    mutateState((current) => ({ ...current, onmyagentServerSettings: {} }));
    queueHealthCheck(0);
  };

  const shouldWaitForLocalHostInfo = () =>
    isDesktopRuntime() &&
    options.startupPreference() !== "server" &&
    !state.onmyagentServerHostInfoReady;

  const shouldRetryStartupCheck = (status: OnMyAgentServerStatus) =>
    status !== "connected" &&
    isDesktopRuntime() &&
    options.startupPreference() !== "server" &&
    Date.now() - bootStartedAt < 5_000;

  const checkOnMyAgentServer = async (url: string, token?: string, hostToken?: string) => {
    const client = createOnMyAgentServerClient({ baseUrl: url, token, hostToken });
    try {
      await client.health();
    } catch (error) {
      const resolved = error as OnMyAgentServerError | Error;
      if ("status" in resolved && (resolved.status === 401 || resolved.status === 403)) {
        return { status: "limited" as OnMyAgentServerStatus, capabilities: null };
      }
      return { status: "disconnected" as OnMyAgentServerStatus, capabilities: null };
    }

    if (!token) {
      return { status: "limited" as OnMyAgentServerStatus, capabilities: null };
    }

    try {
      const capabilities = await client.capabilities();
      return { status: "connected" as OnMyAgentServerStatus, capabilities };
    } catch (error) {
      const resolved = error as OnMyAgentServerError | Error;
      if ("status" in resolved && (resolved.status === 401 || resolved.status === 403)) {
        return { status: "limited" as OnMyAgentServerStatus, capabilities: null };
      }
      return { status: "disconnected" as OnMyAgentServerStatus, capabilities: null };
    }
  };

  const clearHealthTimeout = () => {
    if (healthTimeoutId !== null) {
      window.clearTimeout(healthTimeoutId);
      healthTimeoutId = null;
    }
  };

  const queueHealthCheck = (delayMs: number) => {
    if (disposed || typeof window === "undefined") return;
    clearHealthTimeout();
    healthTimeoutId = window.setTimeout(() => {
      healthTimeoutId = null;
      void runHealthCheck();
    }, Math.max(0, delayMs));
  };

  const runHealthCheck = async () => {
    if (disposed || typeof window === "undefined") return;
    if (!options.documentVisible()) {
      queueHealthCheck(healthDelayMs);
      return;
    }
    if (shouldWaitForLocalHostInfo()) {
      queueHealthCheck(250);
      return;
    }
    if (healthBusy) return;

    const url = getBaseUrl().trim();
    const auth = getAuth();
    if (!url) {
      consecutiveHealthFailures = 0;
      mutateState((current) => ({
        ...current,
        onmyagentServerStatus: "disconnected",
        onmyagentServerCapabilities: null,
        onmyagentServerCheckedAt: Date.now(),
      }));
      return;
    }

    healthBusy = true;
    try {
      let result = await checkOnMyAgentServer(url, auth.token, auth.hostToken);

      if (shouldRetryStartupCheck(result.status)) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
        if (disposed) return;

        try {
          const info = await onmyagentServerInfo() as OnMyAgentServerInfo;
          if (disposed) return;

          mutateState((current) => ({
            ...current,
            onmyagentServerHostInfo: info,
            onmyagentServerHostInfoReady: true,
          }));

          const retryUrl = info.baseUrl?.trim() ?? "";
          const retryToken = info.clientToken?.trim() || undefined;
          const retryHostToken = info.hostToken?.trim() || undefined;
          if (retryUrl) {
            result = await checkOnMyAgentServer(retryUrl, retryToken, retryHostToken);
          }
        } catch {
          // Preserve the original check result when the retry probe fails.
        }
      }

      if (disposed) return;
      const previousStatus = state.onmyagentServerStatus;
      const previousCapabilities = state.onmyagentServerCapabilities;
      const healthy = result.status === "connected" || result.status === "limited";
      if (healthy) {
        consecutiveHealthFailures = 0;
        healthDelayMs = 10_000;
      } else {
        consecutiveHealthFailures += 1;
        healthDelayMs = Math.min(healthDelayMs * 2, 60_000);
      }

      const preservePrevious =
        !healthy &&
        consecutiveHealthFailures < 3 &&
        (previousStatus === "connected" || previousStatus === "limited");

      mutateState((current) => ({
        ...current,
        onmyagentServerStatus: preservePrevious ? previousStatus : result.status,
        onmyagentServerCapabilities: preservePrevious ? previousCapabilities : result.capabilities,
        onmyagentServerCheckedAt: Date.now(),
      }));
    } catch {
      healthDelayMs = Math.min(healthDelayMs * 2, 60_000);
      mutateState((current) => ({
        ...current,
        onmyagentServerCheckedAt: Date.now(),
      }));
    } finally {
      healthBusy = false;
      if (!disposed) queueHealthCheck(healthDelayMs);
    }
  };

  const syncFromOptions = () => {
    refreshSnapshot();
    emitChange();

    if (!isDesktopRuntime()) return;
    const port = state.onmyagentServerHostInfo?.port;
    if (!port) return;
    if (state.onmyagentServerSettings.portOverride === port) return;

    updateOnMyAgentServerSettings({
      ...state.onmyagentServerSettings,
      portOverride: port,
    });
  };

  const startInterval = (key: string, fn: () => void, ms: number) => {
    if (typeof window === "undefined") return;
    if (intervals.has(key)) return;
    intervals.set(key, window.setInterval(fn, ms));
  };

  const stopInterval = (key: string) => {
    const id = intervals.get(key);
    if (id === undefined) return;
    window.clearInterval(id);
    intervals.delete(key);
  };

  const start = () => {
    if (typeof window === "undefined") return;
    if (started) return;
    // Allow restart after a prior dispose() (React 18 StrictMode double-mounts
    // each effect in dev: mount → dispose → re-mount). If we early-return when
    // `disposed` is true, the real mount never arms polling and the UI stays
    // on stale/empty state forever.
    disposed = false;
    started = true;

    syncFromOptions();
    queueHealthCheck(0);
    visibilityChangeHandler = () => {
      if (!options.documentVisible()) return;
      consecutiveHealthFailures = 0;
      queueHealthCheck(0);
    };
    window.addEventListener("visibilitychange", visibilityChangeHandler);

    const refreshHostInfo = () => {
      if (!isDesktopRuntime()) return;
      if (!options.documentVisible()) return;
      void (async () => {
        try {
          const info = await onmyagentServerInfo() as OnMyAgentServerInfo;
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            onmyagentServerHostInfo: info,
            onmyagentServerHostInfoReady: true,
          }));
        } catch {
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            onmyagentServerHostInfo: null,
            onmyagentServerHostInfoReady: true,
          }));
        }
      })();
    };
    refreshHostInfo();
    startInterval("hostInfo", refreshHostInfo, 10_000);

    const refreshDiagnostics = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        setStateField("onmyagentServerDiagnostics", null);
        return;
      }

      const client = getClient();
      if (!client || state.onmyagentServerStatus === "disconnected") {
        setStateField("onmyagentServerDiagnostics", null);
        return;
      }

      void (async () => {
        try {
          const status = await client.status();
          if (!disposed) setStateField("onmyagentServerDiagnostics", status);
        } catch {
          if (!disposed) setStateField("onmyagentServerDiagnostics", null);
        }
      })();
    };
    refreshDiagnostics();
    startInterval("diagnostics", refreshDiagnostics, 10_000);

    const refreshDevtoolsWorkspace = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        setStateField("devtoolsWorkspaceId", null);
        return;
      }

      const client = getClient();
      if (!client) {
        setStateField("devtoolsWorkspaceId", null);
        return;
      }

      void (async () => {
        try {
          const response = await client.listWorkspaces();
          if (disposed) return;
          const items = Array.isArray(response.items) ? response.items : [];
          const activeMatch = response.activeId
            ? items.find((item) => item.id === response.activeId)
            : null;
          setStateField("devtoolsWorkspaceId", activeMatch?.id ?? items[0]?.id ?? null);
        } catch {
          if (!disposed) setStateField("devtoolsWorkspaceId", null);
        }
      })();
    };
    refreshDevtoolsWorkspace();
    startInterval("devtoolsWorkspace", refreshDevtoolsWorkspace, 20_000);

    const refreshAudit = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        mutateState((current) => ({
          ...current,
          onmyagentAuditEntries: [],
          onmyagentAuditStatus: "idle",
          onmyagentAuditError: null,
        }));
        return;
      }

      const client = getClient();
      const workspaceId = state.devtoolsWorkspaceId;
      if (!client || !workspaceId) {
        mutateState((current) => ({
          ...current,
          onmyagentAuditEntries: [],
          onmyagentAuditStatus: "idle",
          onmyagentAuditError: null,
        }));
        return;
      }

      mutateState((current) => ({
        ...current,
        onmyagentAuditStatus: "loading",
        onmyagentAuditError: null,
      }));

      void (async () => {
        try {
          const result = await client.listAudit(workspaceId, 50);
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            onmyagentAuditEntries: Array.isArray(result.items) ? result.items : [],
            onmyagentAuditStatus: "idle",
          }));
        } catch (error) {
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            onmyagentAuditEntries: [],
            onmyagentAuditStatus: "error",
            onmyagentAuditError:
              error instanceof Error
                ? error.message
                : t("app.error_audit_load"),
          }));
        }
      })();
    };
    refreshAudit();
    startInterval("audit", refreshAudit, 15_000);
  };

  const dispose = () => {
    disposed = true;
    started = false;
    clearHealthTimeout();
    if (visibilityChangeHandler && typeof window !== "undefined") {
      window.removeEventListener("visibilitychange", visibilityChangeHandler);
      visibilityChangeHandler = null;
    }
    for (const key of [...intervals.keys()]) stopInterval(key);
  };

  const testOnMyAgentServerConnection = async (next: OnMyAgentServerSettings) => {
    const derived = normalizeOnMyAgentServerUrl(next.urlOverride ?? "");
    if (!derived) {
      mutateState((current) => ({
        ...current,
        onmyagentServerStatus: "disconnected",
        onmyagentServerCapabilities: null,
        onmyagentServerCheckedAt: Date.now(),
      }));
      return false;
    }

    const result = await checkOnMyAgentServer(derived, next.token);
    consecutiveHealthFailures = result.status === "disconnected" ? consecutiveHealthFailures + 1 : 0;
    mutateState((current) => ({
      ...current,
      onmyagentServerStatus: result.status,
      onmyagentServerCapabilities: result.capabilities,
      onmyagentServerCheckedAt: Date.now(),
    }));

    const ok = result.status === "connected" || result.status === "limited";
    if (ok && !isDesktopRuntime()) {
      const active = options.selectedWorkspaceDisplay();
      const shouldAttach =
        !options.activeClient() ||
        active.workspaceType !== "remote" ||
        active.remoteType !== "onmyagent";
      if (shouldAttach) {
        await options
          .createRemoteWorkspaceFlow({
            onmyagentHostUrl: derived,
            onmyagentToken: next.token ?? null,
          })
          .catch(() => undefined);
      }
    }
    return ok;
  };

  const reconnectOnMyAgentServer = async () => {
    if (state.onmyagentReconnectBusy) return false;
    setStateField("onmyagentReconnectBusy", true);

    try {
      let hostInfo = state.onmyagentServerHostInfo;
      if (isDesktopRuntime()) {
        try {
          hostInfo = await onmyagentServerInfo() as OnMyAgentServerInfo;
          mutateState((current) => ({ ...current, onmyagentServerHostInfo: hostInfo }));
        } catch {
          hostInfo = null;
          setStateField("onmyagentServerHostInfo", null);
        }
      }

      if (hostInfo?.clientToken?.trim() && options.startupPreference() !== "server") {
        const liveToken = hostInfo.clientToken.trim();
        const settings = state.onmyagentServerSettings;
        if ((settings.token?.trim() ?? "") !== liveToken) {
          updateOnMyAgentServerSettings({ ...settings, token: liveToken });
        }
      }

      const url = getBaseUrl().trim();
      const auth = getAuth();
      if (!url) {
        mutateState((current) => ({
          ...current,
          onmyagentServerStatus: "disconnected",
          onmyagentServerCapabilities: null,
          onmyagentServerCheckedAt: Date.now(),
        }));
        return false;
      }

      const result = await checkOnMyAgentServer(url, auth.token, auth.hostToken);
      mutateState((current) => ({
        ...current,
        onmyagentServerStatus: result.status,
        onmyagentServerCapabilities: result.capabilities,
        onmyagentServerCheckedAt: Date.now(),
      }));
      return result.status === "connected" || result.status === "limited";
    } finally {
      setStateField("onmyagentReconnectBusy", false);
    }
  };

  async function ensureLocalOnMyAgentServerClient(): Promise<OnMyAgentServerClient | null> {
    let hostInfo = state.onmyagentServerHostInfo;
    if (hostInfo?.baseUrl?.trim() && hostInfo.clientToken?.trim()) {
      const existing = createOnMyAgentServerClient({
        baseUrl: hostInfo.baseUrl.trim(),
        token: hostInfo.clientToken.trim(),
        hostToken: hostInfo.hostToken?.trim() || undefined,
      });
      try {
        await existing.health();
        if (options.startupPreference() !== "server") {
          await reconnectOnMyAgentServer();
        }
        return existing;
      } catch {
        // Fall through to a local restart.
      }
    }

    if (!isDesktopRuntime()) return null;

    try {
      hostInfo = await onmyagentServerRestart({
        remoteAccessEnabled: state.onmyagentServerSettings.remoteAccessEnabled === true,
      }) as OnMyAgentServerInfo;
      mutateState((current) => ({ ...current, onmyagentServerHostInfo: hostInfo }));
    } catch {
      return null;
    }

    const baseUrl = hostInfo?.baseUrl?.trim() ?? "";
    const token = hostInfo?.clientToken?.trim() ?? "";
    const hostToken = hostInfo?.hostToken?.trim() ?? "";
    if (!baseUrl || !token) return null;

    if (options.startupPreference() !== "server") {
      await reconnectOnMyAgentServer();
    }

    return createOnMyAgentServerClient({
      baseUrl,
      token,
      hostToken: hostToken || undefined,
    });
  }

  const saveShareRemoteAccess = async (enabled: boolean) => {
    if (state.shareRemoteAccessBusy) return;
    const previous = state.onmyagentServerSettings;
    const next: OnMyAgentServerSettings = {
      ...previous,
      remoteAccessEnabled: enabled,
    };

    mutateState((current) => ({
      ...current,
      shareRemoteAccessBusy: true,
      shareRemoteAccessError: null,
    }));
    updateOnMyAgentServerSettings(next);

    try {
      if (isDesktopRuntime() && options.selectedWorkspaceDisplay().workspaceType === "local") {
        const restarted = await options.restartLocalServer();
        if (!restarted) {
          throw new Error(t("app.error_restart_local_worker"));
        }
        await reconnectOnMyAgentServer();
      }
    } catch (error) {
      updateOnMyAgentServerSettings(previous);
      mutateState((current) => ({
        ...current,
        shareRemoteAccessError:
          error instanceof Error
            ? error.message
            : t("app.error_remote_access"),
      }));
      return;
    } finally {
      setStateField("shareRemoteAccessBusy", false);
    }
  };

  refreshSnapshot();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => snapshot;

  return {
    subscribe,
    getSnapshot,
    start,
    dispose,
    syncFromOptions,
    setOnMyAgentServerSettings,
    updateOnMyAgentServerSettings,
    resetOnMyAgentServerSettings,
    saveShareRemoteAccess,
    checkOnMyAgentServer,
    testOnMyAgentServerConnection,
    reconnectOnMyAgentServer,
    ensureLocalOnMyAgentServerClient,
  };
}

export function useOnMyAgentServerStoreSnapshot(store: OnMyAgentServerStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
