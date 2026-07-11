/** @jsxImportSource react */
import { useEffect, useMemo, useReducer, useRef } from "react";
import { RefreshCcw } from "lucide-react";

import { readDevLogs } from "../../../../app/lib/dev-log";
import { readPerfLogs } from "../../../../app/lib/perf-log";
import {
  buildOnMyAgentWorkspaceBaseUrl,
  parseOnMyAgentWorkspaceIdFromUrl,
  type OnMyAgentServerSettings,
  type OnMyAgentServerStatus,
} from "../../../../app/lib/onmyagent-server";
import type { OnMyAgentServerInfo } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import {
  ConfigDiagnosticsSection,
  ConfigEngineReloadSection,
  ConfigMessagingIdentitiesSection,
  ConfigServerConnectionSection,
  ConfigServerSharingSection,
  ConfigWorkspaceSummary,
} from "./config-view-sections";
import { configLocalReducer, initialConfigLocalState } from "./config-view-state";

export type ConfigViewProps = {
  busy: boolean;
  clientConnected: boolean;
  anyActiveRuns: boolean;

  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerUrl: string;
  onmyagentServerSettings: OnMyAgentServerSettings;
  onmyagentServerHostInfo: OnMyAgentServerInfo | null;
  runtimeWorkspaceId: string | null;

  updateOnMyAgentServerSettings: (next: OnMyAgentServerSettings) => void;
  resetOnMyAgentServerSettings: () => void;
  testOnMyAgentServerConnection: (
    next: OnMyAgentServerSettings,
  ) => Promise<boolean>;

  canReloadWorkspace: boolean;
  reloadWorkspaceEngine: () => Promise<void>;
  reloadBusy: boolean;
  reloadError: string | null;

  developerMode: boolean;
};

function buildDiagnosticsBundleJson(input: {
  anyActiveRuns: boolean;
  canReloadWorkspace: boolean;
  clientConnected: boolean;
  developerMode: boolean;
  hostConnectUrl: string;
  hostConnectUrlUsesMdns: boolean;
  hostInfo: OnMyAgentServerInfo | null;
  onmyagentServerSettings: OnMyAgentServerSettings;
  onmyagentServerStatus: OnMyAgentServerStatus;
  onmyagentServerUrl: string;
  runtimeWorkspaceId: string | null;
}) {
  const urlOverride = input.onmyagentServerSettings.urlOverride?.trim() ?? "";
  const token = input.onmyagentServerSettings.token?.trim() ?? "";
  const developerLogs = input.developerMode ? readDevLogs(80) : [];
  const perfLogs = input.developerMode ? readPerfLogs(80) : [];
  const bundle = {
    capturedAt: new Date().toISOString(),
    runtime: {
      desktop: isDesktopRuntime(),
      developerMode: input.developerMode,
    },
    workspace: {
      runtimeWorkspaceId: input.runtimeWorkspaceId ?? null,
      clientConnected: input.clientConnected,
      anyActiveRuns: input.anyActiveRuns,
    },
    onmyagentServer: {
      status: input.onmyagentServerStatus,
      url: input.onmyagentServerUrl,
      settings: {
        urlOverride: urlOverride || null,
        tokenPresent: Boolean(token),
      },
      host: input.hostInfo
        ? {
            running: Boolean(input.hostInfo.running),
            remoteAccessEnabled: input.hostInfo.remoteAccessEnabled,
            baseUrl: input.hostInfo.baseUrl ?? null,
            connectUrl: input.hostInfo.connectUrl ?? null,
            mdnsUrl: input.hostInfo.mdnsUrl ?? null,
            lanUrl: input.hostInfo.lanUrl ?? null,
          }
        : null,
    },
    reload: {
      canReloadWorkspace: input.canReloadWorkspace,
    },
    sharing: {
      hostConnectUrl: input.hostConnectUrl || null,
      hostConnectUrlUsesMdns: input.hostConnectUrlUsesMdns,
    },
    performance: {
      retainedEntries: perfLogs.length,
      recent: perfLogs,
    },
    developerLogs: {
      retainedEntries: developerLogs.length,
      recent: developerLogs,
    },
  };
  return JSON.stringify(bundle, null, 2);
}

export function ConfigView(props: ConfigViewProps) {
  const [localState, dispatchLocal] = useReducer(
    configLocalReducer,
    initialConfigLocalState,
  );
  const { onmyagentConnection, tokenVisible, copyingField } = localState;
  const onmyagentUrl = onmyagentConnection.url;
  const onmyagentToken = onmyagentConnection.token;
  const onmyagentTestState = onmyagentConnection.testState;
  const onmyagentTestMessage = onmyagentConnection.testMessage;
  const copyTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    dispatchLocal({
      type: "serverSettings",
      connection: {
        url: props.onmyagentServerSettings.urlOverride ?? "",
        token: props.onmyagentServerSettings.token ?? "",
        testState: "idle",
        testMessage: null,
      },
    });
  }, [props.onmyagentServerSettings]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== undefined) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const onmyagentStatusLabel = (() => {
    switch (props.onmyagentServerStatus) {
      case "connected":
        return t("config.status_connected");
      case "limited":
        return t("config.status_limited");
      default:
        return t("config.status_not_connected");
    }
  })();

  const onmyagentStatusTone = (() => {
    switch (props.onmyagentServerStatus) {
      case "connected":
        return "accent";
      case "limited":
        return "warning";
      default:
        return "neutral";
    }
  })();

  const reloadAvailabilityReason = (() => {
    if (!props.clientConnected) return t("config.reload_connect_hint");
    if (!props.canReloadWorkspace) return t("config.reload_availability_hint");
    return null;
  })();

  const reloadButtonLabel = props.reloadBusy
    ? t("config.reloading")
    : t("config.reload_engine");
  const reloadButtonTone: "destructive" | "secondary" = props.anyActiveRuns
    ? "destructive"
    : "secondary";
  const reloadButtonDisabled =
    props.reloadBusy || Boolean(reloadAvailabilityReason);

  const buildOnMyAgentSettings = (): OnMyAgentServerSettings => ({
    ...props.onmyagentServerSettings,
    urlOverride: onmyagentUrl.trim() || undefined,
    token: onmyagentToken.trim() || undefined,
  });

  const hasOnMyAgentChanges = (() => {
    const currentUrl = props.onmyagentServerSettings.urlOverride ?? "";
    const currentToken = props.onmyagentServerSettings.token ?? "";
    return (
      onmyagentUrl.trim() !== currentUrl || onmyagentToken.trim() !== currentToken
    );
  })();

  const resolvedWorkspaceId = (() => {
    const explicitId = props.runtimeWorkspaceId?.trim() ?? "";
    if (explicitId) return explicitId;
    return parseOnMyAgentWorkspaceIdFromUrl(onmyagentUrl) ?? "";
  })();

  const resolvedWorkspaceUrl = (() => {
    const baseUrl = onmyagentUrl.trim();
    if (!baseUrl) return "";
    return buildOnMyAgentWorkspaceBaseUrl(baseUrl, resolvedWorkspaceId) ?? baseUrl;
  })();

  const hostInfo = props.onmyagentServerHostInfo;
  const hostRemoteAccessEnabled = hostInfo?.remoteAccessEnabled === true;
  const hostStatusLabel = !hostInfo?.running
    ? t("config.host_offline")
    : hostRemoteAccessEnabled
      ? t("config.host_remote_enabled")
      : t("config.host_local_only");
  const hostStatusStyle = !hostInfo?.running
    ? "bg-dls-active text-dls-secondary border-dls-mist"
    : "bg-dls-accent/10 text-dls-accent border-dls-accent/30";
  const hostConnectUrl =
    hostInfo?.connectUrl ??
    hostInfo?.mdnsUrl ??
    hostInfo?.lanUrl ??
    hostInfo?.baseUrl ??
    "";
  const hostConnectUrlUsesMdns = hostConnectUrl.includes(".local");

  const diagnosticsBundleJson = useMemo(() => {
    return buildDiagnosticsBundleJson({
      anyActiveRuns: props.anyActiveRuns,
      canReloadWorkspace: props.canReloadWorkspace,
      clientConnected: props.clientConnected,
      developerMode: props.developerMode,
      hostConnectUrl,
      hostConnectUrlUsesMdns,
      hostInfo,
      onmyagentServerSettings: props.onmyagentServerSettings,
      onmyagentServerStatus: props.onmyagentServerStatus,
      onmyagentServerUrl: props.onmyagentServerUrl,
      runtimeWorkspaceId: props.runtimeWorkspaceId,
    });
  }, [
    hostConnectUrl,
    hostConnectUrlUsesMdns,
    hostInfo,
    props.anyActiveRuns,
    props.canReloadWorkspace,
    props.clientConnected,
    props.developerMode,
    props.onmyagentServerSettings.token,
    props.onmyagentServerSettings.urlOverride,
    props.onmyagentServerStatus,
    props.onmyagentServerUrl,
    props.runtimeWorkspaceId,
  ]);

  const handleCopy = async (value: string, field: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      dispatchLocal({ type: "copyingField", field });
      if (copyTimeoutRef.current !== undefined) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        dispatchLocal({ type: "copyingField", field: null });
        copyTimeoutRef.current = undefined;
      }, 2000);
    } catch {
      // ignore
    }
  };

  const handleTestConnection = async () => {
    if (onmyagentTestState === "testing") return;
    const next = buildOnMyAgentSettings();
    props.updateOnMyAgentServerSettings(next);
    dispatchLocal({
      type: "testState",
      testState: "testing",
      testMessage: null,
    });
    try {
      const ok = await props.testOnMyAgentServerConnection(next);
      dispatchLocal({
        type: "testState",
        testState: ok ? "success" : "error",
        testMessage: ok
          ? t("config.connection_successful")
          : t("config.connection_failed"),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("config.connection_failed_check");
      dispatchLocal({
        type: "testState",
        testState: "error",
        testMessage: message,
      });
    }
  };

  return (
    <section className="space-y-6 max-w-3xl w-full">
      <ConfigWorkspaceSummary runtimeWorkspaceId={props.runtimeWorkspaceId} />
      <ConfigEngineReloadSection
        anyActiveRuns={props.anyActiveRuns}
        reloadBusy={props.reloadBusy}
        reloadError={props.reloadError}
        reloadAvailabilityReason={reloadAvailabilityReason}
        reloadButtonTone={reloadButtonTone}
        reloadButtonDisabled={reloadButtonDisabled}
        reloadButtonLabel={reloadButtonLabel}
        onReload={props.reloadWorkspaceEngine}
      />
      {props.developerMode ? (
        <ConfigDiagnosticsSection
          busy={props.busy}
          diagnosticsBundleJson={diagnosticsBundleJson}
          copyingField={copyingField}
          onCopy={handleCopy}
        />
      ) : null}
      {hostInfo ? (
        <ConfigServerSharingSection
          hostInfo={hostInfo}
          hostConnectUrl={hostConnectUrl}
          hostRemoteAccessEnabled={hostRemoteAccessEnabled}
          hostConnectUrlUsesMdns={hostConnectUrlUsesMdns}
          hostStatusLabel={hostStatusLabel}
          hostStatusStyle={hostStatusStyle}
          tokenVisible={tokenVisible}
          copyingField={copyingField}
          onCopy={handleCopy}
          onToggleToken={(key) => dispatchLocal({ type: "toggleToken", key })}
        />
      ) : null}
      <ConfigServerConnectionSection
        busy={props.busy}
        onmyagentUrl={onmyagentUrl}
        onmyagentToken={onmyagentToken}
        tokenVisible={tokenVisible.onmyagent}
        onmyagentStatusLabel={onmyagentStatusLabel}
        onmyagentStatusTone={onmyagentStatusTone}
        resolvedWorkspaceUrl={resolvedWorkspaceUrl}
        resolvedWorkspaceId={resolvedWorkspaceId}
        onmyagentTestState={onmyagentTestState}
        onmyagentTestMessage={onmyagentTestMessage}
        hasOnMyAgentChanges={hasOnMyAgentChanges}
        onUrlChange={(url) => dispatchLocal({ type: "url", url })}
        onTokenChange={(token) => dispatchLocal({ type: "token", token })}
        onToggleToken={() => dispatchLocal({ type: "toggleToken", key: "onmyagent" })}
        onTestConnection={handleTestConnection}
        onSave={() => props.updateOnMyAgentServerSettings(buildOnMyAgentSettings())}
        onReset={props.resetOnMyAgentServerSettings}
      />
      <ConfigMessagingIdentitiesSection />
      {!isDesktopRuntime() ? <div className="text-xs text-dls-secondary">{t("config.desktop_only_hint")}</div> : null}
    </section>
  );
}
