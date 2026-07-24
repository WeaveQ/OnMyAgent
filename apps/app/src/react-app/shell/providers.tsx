/** @jsxImportSource react */
import { useEffect, type ReactNode } from "react";

import { isWebDeployment } from "../../app/lib/onmyagent-deployment";
import { hydrateOnMyAgentServerSettingsFromEnv } from "../../app/lib/onmyagent-server";
import { isDesktopRuntime } from "../../app/utils";
import { DenAuthProvider, DesktopConfigProvider, RestrictionNoticeProvider } from "../domains/cloud";
import { StatusToastsProvider } from "../domains/shell-feedback";
import { LocalProvider } from "../kernel/local-provider";
import { ServerProvider } from "../kernel/server-provider";
import { AgentReadyDesktopNotificationMonitor } from "./agent-ready-desktop-notification-monitor";
import { AutomationRunDesktopNotificationMonitor } from "./automation-run-desktop-notification-monitor";
import { UpdateAvailableNoticeMonitor } from "./update-available-notice-monitor";
import { ArchitectureMismatchGate } from "./architecture-mismatch-gate";
import { BootStateProvider } from "./boot-state";
import { DesktopRuntimeBoot } from "./desktop-runtime-boot";
import { startDebugLogger, stopDebugLogger } from "./debug-logger";
import { resolveOnMyAgentConnection } from "./onmyagent-connection";
import { ReloadCoordinatorProvider } from "./reload-coordinator";

function resolveDefaultServerUrl(): string {
  if (isDesktopRuntime()) return "http://127.0.0.1:4096";

  const onmyagentUrl =
    typeof import.meta.env?.VITE_ONMYAGENT_URL === "string"
      ? import.meta.env.VITE_ONMYAGENT_URL.trim()
      : "";
  if (onmyagentUrl) {
    return `${onmyagentUrl.replace(/\/+$/, "")}/opencode`;
  }

  if (isWebDeployment() && import.meta.env.PROD && typeof window !== "undefined") {
    return `${window.location.origin}/opencode`;
  }

  const envUrl =
    typeof import.meta.env?.VITE_OPENCODE_URL === "string"
      ? import.meta.env.VITE_OPENCODE_URL.trim()
      : "";
  return envUrl || "http://127.0.0.1:4096";
}

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  hydrateOnMyAgentServerSettingsFromEnv();

  useEffect(() => {
    // Start the dev observability forwarder. Reads the current onmyagent-server
    // URL on every flush so reconnects after port changes still work. In prod
    // builds `startDebugLogger` is a no-op.
    startDebugLogger({
      serverUrl: async () => (await resolveOnMyAgentConnection()).normalizedBaseUrl,
    });
    return () => {
      stopDebugLogger();
    };
  }, []);

  const defaultUrl = resolveDefaultServerUrl();
  return (
    <BootStateProvider>
      <ServerProvider defaultUrl={defaultUrl}>
        <ArchitectureMismatchGate>
          <DesktopRuntimeBoot />
          <DenAuthProvider>
            <DesktopConfigProvider>
              <RestrictionNoticeProvider>
                <LocalProvider>
                  <StatusToastsProvider>
                    <AgentReadyDesktopNotificationMonitor />
                    <AutomationRunDesktopNotificationMonitor />
                    <UpdateAvailableNoticeMonitor />
                    <ReloadCoordinatorProvider>{children}</ReloadCoordinatorProvider>
                  </StatusToastsProvider>
                </LocalProvider>
              </RestrictionNoticeProvider>
            </DesktopConfigProvider>
          </DenAuthProvider>
        </ArchitectureMismatchGate>
      </ServerProvider>
    </BootStateProvider>
  );
}
