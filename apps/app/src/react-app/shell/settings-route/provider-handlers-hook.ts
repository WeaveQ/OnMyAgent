/**
 * Settings-route provider edit/auth + engine apply handlers.
 * Extracted from settings-route/render.tsx (mechanical split).
 */
import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import type { AgentManagementManagedProvider } from "../../../app/lib/desktop";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type {
  Client,
  ProviderListItem,
  ReloadReason,
  ReloadTrigger,
} from "../../../app/types";
import { isDesktopProviderBlocked } from "../../../app/cloud/desktop-app-restrictions";
import { isDesktopRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import type { RestrictionNoticeController } from "../../domains/cloud";
import type { AiSettingsConnectedProvider } from "../../domains/settings";
import { getReactQueryClient } from "../../infra/query-client";
import { refreshProviderListQueries } from "../../domains/connections";
import { abortSessionSafe } from "../../../app/lib/opencode-session";
import type { UserErrorScenario } from "../../kernel/user-error";
import { buildOpenCodeProviderEditFallback } from "./open-code-provider-edit";
import { canEditOpenCodeProvider } from "./provider-disconnect-policy";
import type { SettingsRouteStateRef } from "./route-stores-hook";
import { restartOnMyAgentServerAndRefresh } from "./server-actions";

export type SettingsProviderHandlersInput = {
  routeStateRef: MutableRefObject<SettingsRouteStateRef>;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  selectedWorkspace: { id?: string } | null | undefined;
  onmyagentClient: OnMyAgentServerClient | null;
  activeClient: Client | null;
  providers: ProviderListItem[];
  providerActionBusyId: string | null;
  disabledProviders: string[];
  checkDesktopRestriction: DesktopAppRestrictionChecker;
  restrictionNotice: RestrictionNoticeController;
  providerAuthStore: {
    openProviderAuthModal: () => void | Promise<void>;
    ensureProjectProviderDisabledState: (
      providerId: string,
      disabled: boolean,
    ) => Promise<unknown>;
    refreshProviders: (opts?: { dispose?: boolean }) => Promise<unknown>;
  };
  findManagedProvider: (
    id: string,
  ) => AgentManagementManagedProvider | null | undefined;
  loadOpenCodeManagedProviders: () => Promise<AgentManagementManagedProvider[]>;
  setOpenCodeManagedProviders: Dispatch<
    SetStateAction<AgentManagementManagedProvider[]>
  >;
  setEditingOpenCodeProvider: Dispatch<
    SetStateAction<AgentManagementManagedProvider | null>
  >;
  setOpenCodeProviderConfigOpen: Dispatch<SetStateAction<boolean>>;
  setProviderActionBusyId: Dispatch<SetStateAction<string | null>>;
  setProviderActionError: Dispatch<SetStateAction<string | null>>;
  setConfigActionStatus: Dispatch<SetStateAction<string | null>>;
  setFacingRouteError: (
    raw: string | null,
    forcedScenario?: UserErrorScenario,
  ) => void;
  reconnectOnMyAgentServer: () => Promise<boolean>;
  refreshRouteState: () => Promise<void>;
  pollMcpServersAfterReloadRef: MutableRefObject<(() => void | Promise<void>) | null>;
  activeReloadBlockingSessions: Array<{ id: string; title: string }>;
  reloadCoordinator: {
    registerWorkspaceReloadControls: (controls: {
      canReloadWorkspaceEngine: () => boolean;
      reloadWorkspaceEngine: () => Promise<boolean>;
      activeSessions: () => Array<{ id: string; title: string }>;
      stopSession: (sessionId: string) => Promise<void>;
    }) => () => void;
    markReloadRequired: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
  };
};

/** Mechanical extract of provider open/edit/auth + engine apply handlers. */
export function useSettingsProviderHandlers(input: SettingsProviderHandlersInput) {
  const {
    routeStateRef,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedWorkspace,
    onmyagentClient,
    activeClient,
    providers,
    providerActionBusyId,
    disabledProviders,
    checkDesktopRestriction,
    restrictionNotice,
    providerAuthStore,
    findManagedProvider,
    loadOpenCodeManagedProviders,
    setOpenCodeManagedProviders,
    setEditingOpenCodeProvider,
    setOpenCodeProviderConfigOpen,
    setProviderActionBusyId,
    setProviderActionError,
    setConfigActionStatus,
    setFacingRouteError,
    reconnectOnMyAgentServer,
    refreshRouteState,
    pollMcpServersAfterReloadRef,
    activeReloadBlockingSessions,
    reloadCoordinator,
  } = input;
  void selectedWorkspaceRoot;

  const handleOpenCustomProviderConfig = useCallback(() => {
    setConfigActionStatus(null);
    setEditingOpenCodeProvider(null);
    setOpenCodeProviderConfigOpen(true);
  }, [setConfigActionStatus, setEditingOpenCodeProvider, setOpenCodeProviderConfigOpen]);

  const handleOpenProviderAuth = useCallback(() => {
    if (checkDesktopRestriction({ restriction: "allowCustomProviders" })) {
      restrictionNotice.show({
        title: t("workspace_list.custom_providers_restricted_title"),
        message: t("workspace_list.custom_providers_restricted_message"),
      });
      return;
    }
    // Official provider list requires a live OpenCode client; avoid a red
    // "load failed / not connected" flash when the runtime is down.
    if (!routeStateRef.current.activeClient) {
      setProviderActionError(t("settings.connect_provider_runtime_required_short"));
      return;
    }
    setProviderActionError(null);
    void providerAuthStore.openProviderAuthModal();
  }, [
    checkDesktopRestriction,
    providerAuthStore,
    restrictionNotice,
    routeStateRef,
    setProviderActionError,
  ]);

  useEffect(() => {
    if (!activeClient || !selectedWorkspaceId) return;
    // Org policy: only force-disable Zen when blocked. When allowed, do not
    // re-enable it — users may have disconnected free OpenCode Zen themselves.
    const zenBlocked = checkDesktopRestriction({ restriction: "allowZenModel" });
    if (!zenBlocked) return;

    void providerAuthStore
      .ensureProjectProviderDisabledState("opencode", true)
      .catch((error) => {
        console.warn("[desktop-app-restrictions] failed to sync Zen restriction", error);
      });
  }, [
    activeClient,
    checkDesktopRestriction,
    disabledProviders,
    providerAuthStore,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
  ]);

  const isProviderBlocked = useCallback(
    (providerId: string) =>
      isDesktopProviderBlocked({
        providerId,
        checkRestriction: checkDesktopRestriction,
      }),
    [checkDesktopRestriction],
  );

  const handleEditOpenCodeProvider = useCallback(
    (provider: AiSettingsConnectedProvider) => {
      if (!canEditOpenCodeProvider(provider)) return;
      setProviderActionError(null);
      const fallback = buildOpenCodeProviderEditFallback(provider, providers);
      // Prefer in-memory inventory for instant open. After save, inventory is
      // updated from the save response (opencodeProviders), so re-edit is fresh
      // without awaiting IPC. Background refresh only updates the list for later.
      const cached = findManagedProvider(provider.id) ?? null;

      if (cached) {
        setEditingOpenCodeProvider(cached);
        setOpenCodeProviderConfigOpen(true);
        void loadOpenCodeManagedProviders().then((next) => {
          setOpenCodeManagedProviders(next);
        });
        return;
      }

      // Cold path: inventory not ready yet, or config-only install (no DB row).
      if (providerActionBusyId) return;
      setProviderActionBusyId(provider.id);
      void loadOpenCodeManagedProviders()
        .then((next) => {
          setOpenCodeManagedProviders(next);
          setEditingOpenCodeProvider(
            next.find((item) => item.id === provider.id) ?? fallback,
          );
          setOpenCodeProviderConfigOpen(true);
        })
        .catch(() => {
          setEditingOpenCodeProvider(fallback);
          setOpenCodeProviderConfigOpen(true);
        })
        .finally(() => {
          setProviderActionBusyId(null);
        });
    },
    [
      findManagedProvider,
      loadOpenCodeManagedProviders,
      providerActionBusyId,
      providers,
      setEditingOpenCodeProvider,
      setOpenCodeManagedProviders,
      setOpenCodeProviderConfigOpen,
      setProviderActionBusyId,
      setProviderActionError,
    ],
  );

  /**
   * Apply engine config so a newly saved provider/model is usable immediately.
   * Prefer soft OpenCode instance dispose (fast); fall back to full desktop
   * managed-server restart when soft reload fails (stale binary / plugin mess).
   */
  const applyEngineConfigForProviders = useCallback(async () => {
    const workspaceId =
      routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId.trim();
    if (!onmyagentClient || !workspaceId) {
      return false;
    }

    let softOk = false;
    try {
      await onmyagentClient.reloadEngine(workspaceId);
      softOk = true;
    } catch {
      softOk = false;
    }

    if (!softOk && isDesktopRuntime()) {
      const hardOk = await restartOnMyAgentServerAndRefresh({
        reconnectOnMyAgentServer,
        refreshRouteState,
      });
      if (!hardOk) return false;
    } else if (!softOk) {
      return false;
    }

    await refreshProviderListQueries(getReactQueryClient()).catch(() => null);
    try {
      window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
    } catch {
      // ignore
    }
    void pollMcpServersAfterReloadRef.current?.();
    return true;
  }, [
    onmyagentClient,
    pollMcpServersAfterReloadRef,
    reconnectOnMyAgentServer,
    refreshRouteState,
    routeStateRef,
    selectedWorkspaceId,
  ]);

  const reloadWorkspaceEngineFromUi = useCallback(async () => {
    const workspaceId =
      routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId.trim();
    if (!onmyagentClient || !workspaceId) {
      setFacingRouteError(null, "not_connected");
      return false;
    }
    return applyEngineConfigForProviders();
  }, [
    applyEngineConfigForProviders,
    onmyagentClient,
    routeStateRef,
    selectedWorkspaceId,
    setFacingRouteError,
  ]);

  useEffect(() => {
    return reloadCoordinator.registerWorkspaceReloadControls({
      canReloadWorkspaceEngine: () =>
        Boolean(onmyagentClient && (selectedWorkspace?.id || selectedWorkspaceId)),
      reloadWorkspaceEngine: reloadWorkspaceEngineFromUi,
      activeSessions: () => activeReloadBlockingSessions,
      stopSession: async (sessionId) => {
        if (!activeClient) return;
        await abortSessionSafe(activeClient, sessionId);
      },
    });
  }, [
    activeClient,
    activeReloadBlockingSessions,
    onmyagentClient,
    reloadCoordinator,
    reloadWorkspaceEngineFromUi,
    selectedWorkspace?.id,
    selectedWorkspaceId,
  ]);

  return {
    handleOpenCustomProviderConfig,
    handleOpenProviderAuth,
    handleEditOpenCodeProvider,
    isProviderBlocked,
    applyEngineConfigForProviders,
    reloadWorkspaceEngineFromUi,
  };
}
