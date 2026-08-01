/**
 * Settings-route refreshRouteState + bootstrap / reconnect / auto-compact effects.
 * Extracted from settings-route/render.tsx (mechanical split).
 */
import {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { createOnMyAgentServerClient, type OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { resolveWorkspaceListSelectedId, type WorkspaceList } from "../../../app/lib/desktop";
import type {
  SidebarSessionItem,
  WorkspaceConnectionState,
} from "../../../app/types";
import { isDesktopRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import { diagnoseRemoteWorkspaceTaskLoadFailure } from "../../domains/workspace";
import type { UserErrorScenario } from "../../kernel/user-error";
import { recordInspectorEvent } from "../app-inspector";
import { useBootState } from "../boot-state";
import { ensureDesktopLocalOnMyAgentConnection } from "../desktop-local-onmyagent";
import { resolveOnMyAgentConnection } from "../onmyagent-connection";
import { readActiveWorkspaceId, writeActiveWorkspaceId } from "../session-memory";
import {
  buildSettingsRefreshErrorEvent,
  buildSettingsSessionMaps,
  buildSettingsWorkspaceBootstrapErrorEvent,
  describeRouteError,
  mapDesktopWorkspace,
  reconcileSelectedWorkspaceId,
  resolveSettingsFallbackWorkspaceId,
  resolveSettingsPreferredWorkspaceId,
  updateSettingsWorkspaceConnectionOverrides,
  type RouteWorkspace,
} from "./model";
import type { SettingsRouteStateRef } from "./route-stores-hook";
import { loadSettingsWorkspaceSessionState } from "./sessions";
import { bootstrapDesktopSettingsWorkspaces } from "./workspace-actions";

export type SettingsRouteRefreshInput = {
  routeWorkspaceId: string;
  navigationSessionId: string | null;
  navigationWorkspaceId: string | null;
  workspacesRef: MutableRefObject<RouteWorkspace[]>;
  workspaces: RouteWorkspace[];
  selectedWorkspace: RouteWorkspace | null;
  selectedWorkspaceId: string;
  onmyagentClient: OnMyAgentServerClient | null;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setWorkspaces: Dispatch<SetStateAction<RouteWorkspace[]>>;
  setSessionsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, SidebarSessionItem[]>>
  >;
  setErrorsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, string | null>>
  >;
  setWorkspaceConnectionOverrides: Dispatch<
    SetStateAction<Record<string, WorkspaceConnectionState>>
  >;
  setLegacySelectedWorkspaceId: Dispatch<SetStateAction<string>>;
  setOnMyAgentClient: Dispatch<SetStateAction<OnMyAgentServerClient | null>>;
  setBaseUrl: Dispatch<SetStateAction<string>>;
  setToken: Dispatch<SetStateAction<string>>;
  setFacingRouteError: (
    raw: string | null,
    forcedScenario?: UserErrorScenario,
  ) => void;
  clearFacingRouteError: () => void;
  routeStateRef: MutableRefObject<SettingsRouteStateRef>;
  setAutoCompactContext: Dispatch<SetStateAction<boolean>>;
  setAutoCompactContextLoaded: Dispatch<SetStateAction<boolean>>;
  autoCompactContext: boolean;
  autoCompactContextBusy: boolean;
  setAutoCompactContextBusy: Dispatch<SetStateAction<boolean>>;
  markReloadRequired: (
    reason: import("../../../app/types").ReloadReason,
    trigger?: import("../../../app/types").ReloadTrigger,
  ) => void;
};

/** Mechanical extract of refreshRouteState + related settings-route effects. */
export function useSettingsRouteRefresh(input: SettingsRouteRefreshInput) {
  const {
    routeWorkspaceId,
    navigationSessionId,
    navigationWorkspaceId,
    workspacesRef,
    workspaces,
    selectedWorkspace,
    selectedWorkspaceId,
    onmyagentClient,
    loading,
    setLoading,
    setWorkspaces,
    setSessionsByWorkspaceId,
    setErrorsByWorkspaceId,
    setWorkspaceConnectionOverrides,
    setLegacySelectedWorkspaceId,
    setOnMyAgentClient,
    setBaseUrl,
    setToken,
    setFacingRouteError,
    clearFacingRouteError,
    routeStateRef,
    setAutoCompactContext,
    setAutoCompactContextLoaded,
    autoCompactContext,
    autoCompactContextBusy,
    setAutoCompactContextBusy,
    markReloadRequired,
  } = input;

  const refreshInFlightRef = useRef(false);
  const reconnectAttemptedWorkspaceIdRef = useRef("");
  const { markRouteReady: markBootRouteReady } = useBootState();

  const refreshRouteState = useMemo(() => async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    clearFacingRouteError();
    let desktopList: WorkspaceList | null = null;
    let desktopWorkspaces = workspacesRef.current;
    try {
      try {
        desktopList = await bootstrapDesktopSettingsWorkspaces();
        if (desktopList) {
          desktopWorkspaces = (desktopList.workspaces ?? []).map(mapDesktopWorkspace);
        }
      } catch (error) {
        const bootstrapError = buildSettingsWorkspaceBootstrapErrorEvent({
          error,
          preservedWorkspaceCount: workspacesRef.current.length,
        });
        console.error("[settings-route] workspaceBootstrap failed", error);
        recordInspectorEvent("route.workspace_bootstrap.error", bootstrapError);
        desktopWorkspaces = workspacesRef.current;
      }
      const { normalizedBaseUrl, resolvedToken, resolvedHostToken } =
        await resolveOnMyAgentConnection();

      if (!normalizedBaseUrl || !resolvedToken) {
        setOnMyAgentClient(null);
        setBaseUrl("");
        setToken("");
        setWorkspaces(desktopWorkspaces);
        setSessionsByWorkspaceId({});
        setErrorsByWorkspaceId({});
        setLegacySelectedWorkspaceId((current) => {
          const next = resolveSettingsFallbackWorkspaceId({
            currentWorkspaceId: current,
            persistedWorkspaceId: readActiveWorkspaceId() || "",
            desktopSelectedId: resolveWorkspaceListSelectedId(desktopList),
            workspaces: desktopWorkspaces,
          });
          writeActiveWorkspaceId(next || null);
          return next;
        });
        return;
      }

      const client = createOnMyAgentServerClient({
        baseUrl: normalizedBaseUrl,
        token: resolvedToken,
        hostToken: resolvedHostToken || undefined,
      });
      const {
        serverList,
        sessionEntries,
        workspaces: nextWorkspaces,
      } = await loadSettingsWorkspaceSessionState({
        client,
        desktopWorkspaces,
        diagnoseRemoteWorkspaceTaskLoadFailure,
        fallbackUnknownError: t("app.unknown_error"),
        remoteConnectionFailedError: t("app.error_remote_worker_connection_failed"),
      });

      setOnMyAgentClient(client);
      setBaseUrl(normalizedBaseUrl);
      setToken(resolvedToken);
      setWorkspaces(nextWorkspaces);
      const sessionMaps = buildSettingsSessionMaps(sessionEntries);
      setSessionsByWorkspaceId(sessionMaps.sessionsByWorkspaceId);
      setErrorsByWorkspaceId(sessionMaps.errorsByWorkspaceId);
      setWorkspaceConnectionOverrides((current) =>
        updateSettingsWorkspaceConnectionOverrides({ current, entries: sessionEntries }),
      );
      setLegacySelectedWorkspaceId((current) => {
        const preferred = resolveSettingsPreferredWorkspaceId({
          routeWorkspaceId,
          navigationSessionId,
          navigationWorkspaceId,
          currentWorkspaceId: current,
          persistedWorkspaceId: readActiveWorkspaceId() || "",
          sessionEntries,
        });
        const next = reconcileSelectedWorkspaceId(
          preferred,
          serverList,
          desktopList,
          nextWorkspaces,
        );
        writeActiveWorkspaceId(next || null);
        return next;
      });
    } catch (error) {
      const message = describeRouteError(error);
      console.error("[settings-route] refreshRouteState failed", error);
      recordInspectorEvent(
        "route.refresh.error",
        buildSettingsRefreshErrorEvent({
          message,
          preservedWorkspaceCount: desktopWorkspaces.length,
        }),
      );
      setFacingRouteError(message);
      if (desktopWorkspaces.length > 0) {
        setWorkspaces(desktopWorkspaces);
        setLegacySelectedWorkspaceId((current) => {
          const next = resolveSettingsFallbackWorkspaceId({
            currentWorkspaceId: current,
            persistedWorkspaceId: readActiveWorkspaceId() || "",
            desktopSelectedId: resolveWorkspaceListSelectedId(desktopList),
            workspaces: desktopWorkspaces,
          });
          writeActiveWorkspaceId(next || null);
          return next;
        });
      }
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
      // Settings can be the first route a user lands on (direct link, deep
      // link, or after reload). Let the boot overlay dismiss once we've
      // completed our first data load.
      markBootRouteReady();
    }
  }, [
    clearFacingRouteError,
    markBootRouteReady,
    navigationSessionId,
    navigationWorkspaceId,
    routeWorkspaceId,
    setBaseUrl,
    setErrorsByWorkspaceId,
    setFacingRouteError,
    setLegacySelectedWorkspaceId,
    setLoading,
    setOnMyAgentClient,
    setSessionsByWorkspaceId,
    setToken,
    setWorkspaceConnectionOverrides,
    setWorkspaces,
    workspacesRef,
  ]);

  useEffect(() => {
    const activeWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    setWorkspaceConnectionOverrides((current) => {
      let changed = false;
      const next: Record<string, WorkspaceConnectionState> = {};
      for (const [workspaceId, state] of Object.entries(current)) {
        if (activeWorkspaceIds.has(workspaceId)) {
          next[workspaceId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [setWorkspaceConnectionOverrides, workspaces]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (loading) return;
    if (onmyagentClient) {
      reconnectAttemptedWorkspaceIdRef.current = "";
      return;
    }
    if (!selectedWorkspace || selectedWorkspace.workspaceType !== "local") return;
    const workspaceId = selectedWorkspace.id?.trim() ?? "";
    if (!workspaceId || reconnectAttemptedWorkspaceIdRef.current === workspaceId) return;
    reconnectAttemptedWorkspaceIdRef.current = workspaceId;

    void ensureDesktopLocalOnMyAgentConnection({
      route: "settings",
      workspace: selectedWorkspace,
      allWorkspaces: workspaces,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : describeRouteError(error);
      setFacingRouteError(message);
    });
  }, [loading, onmyagentClient, selectedWorkspace, setFacingRouteError, workspaces]);

  useEffect(() => {
    void refreshRouteState();
    const handleSettingsChange = () => {
      void refreshRouteState();
    };
    window.addEventListener("onmyagent-server-settings-changed", handleSettingsChange);
    return () => {
      window.removeEventListener("onmyagent-server-settings-changed", handleSettingsChange);
    };
  }, [refreshRouteState]);

  // Load auto-compaction state from OpenCode config on workspace change.
  useEffect(() => {
    if (!onmyagentClient || !selectedWorkspaceId) return;
    const workspaceId =
      routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId;
    let cancelled = false;
    (async () => {
      try {
        const config = await onmyagentClient.getConfig(workspaceId);
        if (cancelled) return;
        const compaction = config.opencode?.compaction;
        const auto =
          compaction && typeof compaction === "object" && "auto" in compaction
            ? (compaction as { auto?: boolean }).auto
            : undefined;
        setAutoCompactContext(auto !== false);
        setAutoCompactContextLoaded(true);
      } catch {
        if (!cancelled) setAutoCompactContextLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    onmyagentClient,
    routeStateRef,
    selectedWorkspaceId,
    setAutoCompactContext,
    setAutoCompactContextLoaded,
  ]);

  const toggleAutoCompactContext = useCallback(async () => {
    if (autoCompactContextBusy) return;
    const workspaceId =
      routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId;
    if (!onmyagentClient || !workspaceId) return;
    const next = !autoCompactContext;
    setAutoCompactContext(next);
    setAutoCompactContextBusy(true);
    try {
      await onmyagentClient.patchConfig(workspaceId, {
        opencode: { compaction: { auto: next } },
      });
      markReloadRequired("config", {
        type: "config",
        name: "opencode.json",
        action: "updated",
      });
    } catch {
      setAutoCompactContext(!next);
    } finally {
      setAutoCompactContextBusy(false);
    }
  }, [
    autoCompactContext,
    autoCompactContextBusy,
    markReloadRequired,
    onmyagentClient,
    routeStateRef,
    selectedWorkspaceId,
    setAutoCompactContext,
    setAutoCompactContextBusy,
  ]);

  return {
    refreshRouteState,
    toggleAutoCompactContext,
  };
}
