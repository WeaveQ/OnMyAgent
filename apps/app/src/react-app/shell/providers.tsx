/** @jsxImportSource react */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { isWebDeployment } from "../../app/lib/onmyagent-deployment";
import { hydrateOnMyAgentServerSettingsFromEnv } from "../../app/lib/onmyagent-server";
import { isDesktopRuntime } from "../../app/utils";
import { DenAuthProvider, DesktopConfigProvider, RestrictionNoticeProvider } from "../domains/cloud";
import { StatusToastsProvider } from "../domains/shell-feedback";
import { LocalProvider } from "../kernel/local-provider";
import { ServerProvider } from "../kernel/server-provider";
import { ArchitectureMismatchGate } from "./architecture-mismatch-gate";
import { BootStateProvider, useBootState } from "./boot-state";
import { DesktopRuntimeBoot } from "./desktop-runtime-boot";
import { startDebugLogger, stopDebugLogger } from "./debug-logger";
import { resolveOnMyAgentConnection } from "./onmyagent-connection";
import { ReloadCoordinatorProvider } from "./reload-coordinator";
import { scheduleIdleWork } from "./session-route/prewarm-schedule";

const DeferredDesktopMonitorRuntime = lazy(() =>
  import("./deferred-desktop-monitor-runtime").then((module) => ({
    default: module.DeferredDesktopMonitorRuntime,
  })),
);

function resolveDefaultServerUrl(): string {
  if (isDesktopRuntime()) return "http://127.0.0.1:4096";

  const onmyagentUrl =
    typeof import.meta.env?.VITE_ONMYAGENT_URL === "string"
      ? import.meta.env.VITE_ONMYAGENT_URL.trim()
      : "";
  if (onmyagentUrl) {
    return onmyagentUrl.replace(/\/+$/, "");
  }

  if (isWebDeployment() && import.meta.env.PROD && typeof window !== "undefined") {
    return window.location.origin;
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

/**
 * Desktop notification / update monitors are not needed for first paint.
 * Mount after boot reaches ready/error, on idle, so they do not compete with
 * engine IPC and session-route refresh on cold start.
 */
function DeferredDesktopMonitors() {
  const { phase } = useBootState();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (phase !== "ready" && phase !== "error") return;
    const scheduled = scheduleIdleWork({
      run: () => setEnabled(true),
      idleTimeoutMs: 4_000,
      fallbackDelayMs: 1_500,
    });
    return () => scheduled.cancel();
  }, [phase]);

  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <DeferredDesktopMonitorRuntime />
    </Suspense>
  );
}

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
                    <DeferredDesktopMonitors />
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
