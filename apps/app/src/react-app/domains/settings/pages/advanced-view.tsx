/** @jsxImportSource react */
import { useReducer } from "react";

import { Separator } from "@/components/ui/separator";

import type { OpencodeConnectStatus } from "@/app/types";
import type { OpenworkServerStatus } from "@/app/lib/onmyagent-server";
import type { EngineInfo } from "@/app/lib/desktop-types";
import { t } from "@/i18n";
import { LayoutStack } from "../settings-layout";

import { advancedLocalReducer, initialAdvancedLocalState } from "./advanced-view-state";
import {
  AdvancedConnectionSection,
  AdvancedDeveloperSection,
  AdvancedFeatureFlagsSection,
  AdvancedOpencodeSection,
  AdvancedRuntimeSection,
} from "./advanced-view-sections";
import { ConfigView, type ConfigViewProps } from "./config-view";

export type AdvancedViewProps = {
  busy: boolean;
  baseUrl: string;
  headerStatus: string;
  clientConnected: boolean;
  opencodeConnectStatus: OpencodeConnectStatus | null;
  onmyagentServerStatus: OpenworkServerStatus;
  onmyagentServerUrl: string;
  onmyagentReconnectBusy: boolean;
  reconnectOpenworkServer: () => Promise<boolean>;
  engineInfo: EngineInfo | null;
  restartLocalServer: () => Promise<boolean>;
  stopHost: () => void;
  developerMode: boolean;
  toggleDeveloperMode: () => void;
  opencodeDevModeEnabled: boolean;
  openDebugDeepLink: (rawUrl: string) => Promise<{ ok: boolean; message: string }>;
  opencodeEnableExa: boolean;
  toggleOpencodeEnableExa: () => void;
  microsandboxCreateSandboxEnabled: boolean;
  toggleMicrosandboxCreateSandbox: () => void;
  configView: ConfigViewProps;
};

type AdvancedStatusTone = "ready" | "warning" | "error" | "neutral";

export function AdvancedView(props: AdvancedViewProps) {
  const [localState, dispatchLocal] = useReducer(
    advancedLocalReducer,
    initialAdvancedLocalState,
  );
  const {
    reconnectStatus: onmyagentReconnectStatus,
    reconnectError: onmyagentReconnectError,
    restartBusy: onmyagentRestartBusy,
    restartStatus: onmyagentRestartStatus,
    restartError: onmyagentRestartError,
    deepLinkOpen: debugDeepLinkOpen,
    deepLinkInput: debugDeepLinkInput,
    deepLinkBusy: debugDeepLinkBusy,
    deepLinkStatus: debugDeepLinkStatus,
  } = localState;

  const clientStatusLabel = (() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return t("status.connecting");
    if (status === "error") return t("settings.connection_failed");
    return props.clientConnected ? t("status.connected") : t("config.status_not_connected");
  })();

  const clientTone: AdvancedStatusTone = (() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return "warning";
    if (status === "error") return "error";
    return props.clientConnected ? "ready" : "neutral";
  })();

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

  const onmyagentTone: AdvancedStatusTone = (() => {
    switch (props.onmyagentServerStatus) {
      case "connected":
        return "ready";
      case "limited":
        return "warning";
      default:
        return "neutral";
    }
  })();

  const isLocalEngineRunning = Boolean(props.engineInfo?.running);

  const handleReconnectOpenworkServer = async () => {
    if (props.busy || props.onmyagentReconnectBusy || !props.onmyagentServerUrl.trim()) return;
    dispatchLocal({ type: "reconnectStart" });
    try {
      const ok = await props.reconnectOpenworkServer();
      if (!ok) {
        dispatchLocal({ type: "reconnectError", error: t("settings.reconnect_failed") });
        return;
      }
      dispatchLocal({ type: "reconnectStatus", status: t("settings.reconnected") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatchLocal({ type: "reconnectError", error: message || t("settings.reconnect_server_failed") });
    }
  };

  const handleRestartLocalServer = async () => {
    if (props.busy || onmyagentRestartBusy) return;
    dispatchLocal({ type: "restartStart" });
    try {
      const ok = await props.restartLocalServer();
      if (!ok) {
        dispatchLocal({ type: "restartError", error: t("settings.restart_failed") });
        return;
      }
      dispatchLocal({ type: "restartStatus", status: t("settings.restarted") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatchLocal({ type: "restartError", error: message || t("settings.restart_server_failed") });
    } finally {
      dispatchLocal({ type: "restartDone" });
    }
  };

  const submitDebugDeepLink = async () => {
    const rawUrl = debugDeepLinkInput.trim();
    if (!rawUrl || props.busy || debugDeepLinkBusy) return;
    dispatchLocal({ type: "deepLinkStart" });
    try {
      const result = await props.openDebugDeepLink(rawUrl);
      if (result.ok) {
        dispatchLocal({ type: "deepLinkSuccess", status: result.message });
      } else {
        dispatchLocal({ type: "deepLinkStatus", status: result.message });
      }
    } catch (error) {
      dispatchLocal({
        type: "deepLinkStatus",
        status: error instanceof Error ? error.message : t("settings.open_deeplink_failed"),
      });
    } finally {
      dispatchLocal({ type: "deepLinkDone" });
    }
  };

  return (
    <LayoutStack>
      <AdvancedRuntimeSection
        engineInfo={props.engineInfo}
        clientStatusLabel={clientStatusLabel}
        clientTone={clientTone}
        onmyagentStatusLabel={onmyagentStatusLabel}
        onmyagentTone={onmyagentTone}
      />

      <Separator />

      <AdvancedOpencodeSection
        busy={props.busy}
        enabled={props.opencodeEnableExa}
        onToggle={props.toggleOpencodeEnableExa}
      />

      <Separator />

      {/* Feature flags section removed -- microsandbox is always on */}

      <AdvancedDeveloperSection
        busy={props.busy}
        developerMode={props.developerMode}
        opencodeDevModeEnabled={props.opencodeDevModeEnabled}
        deepLinkOpen={debugDeepLinkOpen}
        deepLinkInput={debugDeepLinkInput}
        deepLinkBusy={debugDeepLinkBusy}
        deepLinkStatus={debugDeepLinkStatus}
        onToggleDeveloperMode={props.toggleDeveloperMode}
        onToggleDeepLink={() => dispatchLocal({ type: "toggleDeepLink" })}
        onDeepLinkInput={(input) => dispatchLocal({ type: "deepLinkInput", input })}
        onSubmitDeepLink={submitDebugDeepLink}
      />

      <Separator />

      <AdvancedConnectionSection
        busy={props.busy}
        headerStatus={props.headerStatus}
        baseUrl={props.baseUrl}
        onmyagentServerUrl={props.onmyagentServerUrl}
        onmyagentServerStatus={props.onmyagentServerStatus}
        onmyagentReconnectBusy={props.onmyagentReconnectBusy}
        isLocalEngineRunning={isLocalEngineRunning}
        restartBusy={onmyagentRestartBusy}
        reconnectStatus={onmyagentReconnectStatus}
        reconnectError={onmyagentReconnectError}
        restartStatus={onmyagentRestartStatus}
        restartError={onmyagentRestartError}
        onReconnect={handleReconnectOpenworkServer}
        onRestart={handleRestartLocalServer}
        onStopHost={props.stopHost}
      />

      {props.developerMode ? (
        <>
          <Separator />
          <ConfigView {...props.configView} />
        </>
      ) : null}
    </LayoutStack>
  );
}
