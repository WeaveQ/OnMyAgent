/** @jsxImportSource react */
/**
 * Presentational shell for SessionRouteRender: CloudSessionProvider,
 * WorkspaceProvider, ReactSessionRuntime, SessionPage, and SessionRouteModals.
 */
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { NavigateFunction } from "react-router-dom";

import { createClient, unwrap } from "../../../app/lib/opencode";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import {
  resolveWorkspaceEndpoint,
  type ResolvedWorkspaceEndpoint,
} from "../../../app/lib/workspace-endpoint";
import type {
  Client,
  ModelOption,
  ModelRef,
  PendingPermission,
  PendingQuestion,
  ProviderListItem,
  SidebarSessionItem,
  TodoItem,
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../app/types";
import { buildFeedbackUrl } from "../../../app/lib/feedback";
import type { OnMyAgentServerInfo } from "../../../app/lib/desktop";
import { isDesktopRuntime, safeStringify } from "../../../app/utils";
import { t } from "../../../i18n";
import { usePlatform } from "../../kernel/platform";
import type { LocalPreferences } from "../../kernel/local-provider";
import { useBootOverlayVisible, useBootState } from "../boot-state";
import { useColdBootShell } from "./cold-boot-shell";
import {
  SESSION_DELETE_REMOTE_BUDGET_MS,
  SESSION_SNAPSHOT_STALE_TIME_MS,
  SessionPage,
  buildSessionSnapshotPrefetchSpec,
  executePendingSessionDelete,
  isTolerableSessionDeleteFailure,
  markSessionRecentlyDeleted,
  raceSessionDeleteRemote,
  registerPendingSessionDelete,
  retryPendingSessionDeletesForWorkspace,
  resetRailBookmarkToPrimary,
  resolveSessionDeleteDirectory,
  scheduleSessionSnapshot,
  type PageMode,
  type SessionAgentManagementIntent,
  type SessionPageSurfaceProps,
} from "../../domains/session";
import { getReactQueryClient } from "../../infra/query-client";
import { writeCachedSidebarSessionsForWorkspace } from "../session-memory";

import { loadAgentsPage } from "../../domains/agents";
import { TaskCenterPage } from "../../domains/task-center";

// Agents registry UI is heavy and non-critical for the live chat path —
// code-split so it does not ride the main session graph.
const AgentsPage = lazy(() =>
  loadAgentsPage().then((module) => ({
    default: module.AgentsPage,
  })),
);
import { isDesktopProviderBlocked } from "../../../app/cloud/desktop-app-restrictions";
import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import { ReactSessionRuntime } from "../../domains/session";
import { usePendingAgentStore } from "../../domains/agents";
import {
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "../../domains/agents";
import {
  removeAssistantSession,
} from "../../domains/agents";
import { writeSessionOriginDurable } from "../../domains/agents";
import {
  removeAutomationSessionRecord,
  renameAutomationSessionRecord,
} from "../../domains/session";
import {
  claimOrCreateExpertColdSession,
  dispatchAssistantSessionWorkspacesChanged,
  readAssistantSessionWorkspace,
  removeAssistantSessionWorkspace,
  saveSessionDraft,
  writeAssistantSessionWorkspace,
} from "../../domains/session";
import {
  createIsolatedExpertSessionRuntimeDirectory,
  shouldIsolateExpertSessionDirectory,
} from "../../capabilities/session-identity/expert-session-directory";
import { normalizeExpertWritePackageName } from "../../capabilities/session-identity/expert-package-name";
import { useExpertDirectoryStore } from "../../capabilities/session-identity/expert-directory-store";
import { CloudSessionProvider } from "../../domains/settings";
import { installMarketplaceExpertAfterSessionCreated } from "./intent";
import {
  bindPendingAgentToSession,
  resolvePendingAgentForPrompt,
} from "./agent-context";
import { SessionCloudAccountBridge } from "../session-cloud-account-bridge";
import { WorkspaceProvider } from "../workspace-provider";
import { SettingsSurface } from "../settings-route";
import { SessionRouteModals } from "./modals";
import {
  findRouteWorkspace,
  type RouteWorkspace,
  type SessionSidebarAccount,
} from "./model";
import {
  findFirstSessionIdMatching,
  insertSidebarSession,
  sessionListOwnsSession,
} from "./sessions";
import { shouldPrefetchSessionSnapshotOnColdPath } from "./cold-path-budget";
import {
  activateDesktopSessionWorkspaceInBackground,
} from "./workspace-actions";
import {
  focusPromptSoon,
} from "./state";
import {
  resolveSessionRouteModeSwitchPath,
  resolveWorkspaceSelectionSessionTarget,
} from "./control";
import {
  readLastSessionFor,
  writeActiveWorkspaceId,
  writeLastSessionFor,
} from "../session-memory";
import type { OpenTarget } from "../../domains/session";
import type { SessionOption } from "../command-palette";
import type { useRemoteAccessRestart, useRemoteWorkspaceConnectionEditor, useShareWorkspaceState } from "../../domains/workspace";
import type { useProviderAuthStoreSnapshot } from "../../domains/connections";
import type { createProviderAuthStore } from "../../domains/connections";

type RemoteAccessRestart = ReturnType<typeof useRemoteAccessRestart>;
type RemoteWorkspaceConnectionEditor = ReturnType<
  typeof useRemoteWorkspaceConnectionEditor<RouteWorkspace>
>;
type ShareWorkspaceState = ReturnType<typeof useShareWorkspaceState>;
type ProviderAuthStore = ReturnType<typeof createProviderAuthStore>;
type ProviderAuthSnapshot = ReturnType<typeof useProviderAuthStoreSnapshot>;

type NavigateToWorkspaceSession = (
  workspaceId: string,
  sessionId?: string | null,
  options?: { replace?: boolean },
) => void;

export type SessionRoutePageViewProps = {
  activePermission: PendingPermission | null;
  activeQuestion: PendingQuestion | null;
  activeSelectedWorkspaceSessionIds: string[];
  agentManagementIntent: SessionAgentManagementIntent | null;
  allowedModelOptions: ModelOption[];
  autoApprovedPermissionNoticeBySessionId: Record<string, string>;
  baseUrl: string;
  canCreateTask: boolean;
  checkDesktopRestriction: DesktopAppRestrictionChecker;
  clearAgentManagementIntent: (key: string) => void;
  client: OnMyAgentServerClient | null;
  commandPaletteOpen: boolean;
  createWorkspaceBusy: boolean;
  createWorkspaceError: string | null;
  createWorkspaceOpen: boolean;
  createWorkspaceRemoteBusy: boolean;
  createWorkspaceRemoteError: string | null;
  creatingSessionWorkspaceIdsRef: MutableRefObject<Set<string>>;
  developerMode: boolean;
  disabledProviderIds: string[];
  effectiveLoading: boolean;
  endpointForWorkspace: (
    workspace: RouteWorkspace | null | undefined,
  ) => ResolvedWorkspaceEndpoint | null;
  firstSessionIdForPageMode: (workspaceId: string) => string | null;
  forceNewSessionOnNextSendRef: MutableRefObject<boolean>;
  handleCreateRemoteWorkspace: (input: {
    onmyagentHostUrl?: string | null;
    onmyagentToken?: string | null;
    directory?: string | null;
    displayName?: string | null;
  }) => Promise<boolean> | boolean;
  handleCreateTaskInWorkspace: (workspaceId: string) => Promise<void> | void;
  handleCreateWorkspace: (
    preset: import("../../../app/types").WorkspacePreset,
    folder: string | null,
  ) => Promise<void> | void;
  handleForgetWorkspace: (id: string) => Promise<void> | void;
  handleOpenCreateWorkspace: () => void;
  handleOpenRenameWorkspace: (id: string) => void;
  handleOpenSettings: (route?: string, workspaceId?: string) => void;
  handleReorderWorkspaces: (ids: string[]) => void;
  handleRevealWorkspace: (id: string) => Promise<void> | void;
  handleRuntimeSessionUpdated: (update: {
    sessionId: string;
    info: Record<string, unknown>;
  }) => void;
  handleRuntimeSessionStatus: (update: {
    sessionId: string;
    status: unknown;
  }) => void;
  handleSaveRenameWorkspace: () => Promise<void> | void;
  handleSaveShareRemoteAccess: (enabled: boolean) => Promise<void> | void;
  handleShareWorkspace: (id: string) => void;
  handleSignOut: () => void;
  handleExportWorkspaceConfig: (id: string) => Promise<void> | void;
  loadWorkspaceSessionsInBackground: (
    workspaces: RouteWorkspace[],
  ) => Promise<void>;
  local: {
    prefs: LocalPreferences;
    setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void;
  };
  modelPickerOpen: boolean;
  modelPickerQuery: string;
  navigate: NavigateFunction;
  navigateToWorkspaceSession: NavigateToWorkspaceSession;
  onmyagentServerSettings: { remoteAccessEnabled?: boolean };
  opencodeBaseUrl: string;
  opencodeClient: Client | null;
  pageMode: PageMode;
  paletteAccessibleTargets: OpenTarget[];
  paletteSessionOptions: SessionOption[];
  permissionReplyBusy: boolean;
  providerConnectedIds: string[];
  providers: ProviderListItem[];
  questionReplyBusy: boolean;
  refreshRouteState: () => Promise<void> | void;
  rememberPendingCreatedSession: (workspaceId: string, sessionId: string) => void;
  remoteAccessRestart: RemoteAccessRestart;
  remoteWorkspaceConnectionEditor: RemoteWorkspaceConnectionEditor;
  renameWorkspaceBusy: boolean;
  renameWorkspaceId: string | null;
  renameWorkspaceTitle: string;
  respondPermission: (
    requestID: string,
    reply: "once" | "always" | "reject",
  ) => void;
  respondQuestion: (requestID: string, answers: string[][]) => void;
  routeNotFoundMessage: string | null;
  runRemoteWorkspaceConnectionCheck: (
    workspaceId: string,
    mode: "test" | "recover",
  ) => void | Promise<boolean>;
  selectedSessionFileRoot: string;
  selectedSessionId: string | null;
  selectedWorkspace: RouteWorkspace | null | undefined;
  selectedWorkspaceEndpoint: ResolvedWorkspaceEndpoint | null;
  selectedWorkspaceError: string | null;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  selectedWorkspaceServerToken: string;
  isExpertSessionInDirectory: (sessionId: string) => boolean;
  sessionMatchesPageMode: (sessionId: string) => boolean;
  sessionProviderAuthSnapshot: ProviderAuthSnapshot;
  sessionProviderAuthStore: ProviderAuthStore;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  sessionsByWorkspaceIdRef: MutableRefObject<
    Record<string, SidebarSessionItem[]>
  >;
  sessionWorkspaceRoot: string;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setCreateWorkspaceError: Dispatch<SetStateAction<string | null>>;
  setCreateWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  setDisabledProviderIds: Dispatch<SetStateAction<string[]>>;
  setLegacySelectedWorkspaceId: Dispatch<SetStateAction<string>>;
  setModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  setModelPickerQuery: Dispatch<SetStateAction<string>>;
  setPaletteAccessibleTargets: Dispatch<SetStateAction<OpenTarget[]>>;
  setRecentProviderIds: Dispatch<SetStateAction<Set<string>>>;
  setRenameWorkspaceId: Dispatch<SetStateAction<string | null>>;
  setRenameWorkspaceTitle: Dispatch<SetStateAction<string>>;
  setRetryingWorkspaceIds: Dispatch<SetStateAction<string[]>>;
  setSessionsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, SidebarSessionItem[]>>
  >;
  setSidebarAccount: Dispatch<SetStateAction<SessionSidebarAccount | null>>;
  shareWorkspaceState: ShareWorkspaceState;
  showPreparingStatus: boolean;
  sidebarAccount: SessionSidebarAccount | null;
  sidebarSessionStatusById: Record<string, string>;
  surfaceProps: SessionPageSurfaceProps | null;
  suppressRestoreSessionRef: MutableRefObject<boolean>;
  token: string;
  visibleTodos: TodoItem[];
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  workspaceSessionGroups: WorkspaceSessionGroup[];
  workspaces: RouteWorkspace[];
};

export function SessionRoutePageView(props: SessionRoutePageViewProps) {
  const bootOverlayVisible = useBootOverlayVisible();
  const { markRouteReady } = useBootState();
  const coldBootShell = useColdBootShell();
  const {
    activePermission,
    activeQuestion,
    activeSelectedWorkspaceSessionIds,
    agentManagementIntent,
    allowedModelOptions,
    autoApprovedPermissionNoticeBySessionId,
    baseUrl,
    canCreateTask,
    checkDesktopRestriction,
    clearAgentManagementIntent,
    client,
    commandPaletteOpen,
    createWorkspaceBusy,
    createWorkspaceError,
    createWorkspaceOpen,
    createWorkspaceRemoteBusy,
    createWorkspaceRemoteError,
    creatingSessionWorkspaceIdsRef,
    developerMode,
    disabledProviderIds,
    effectiveLoading,
    endpointForWorkspace,
    firstSessionIdForPageMode,
    forceNewSessionOnNextSendRef,
    handleCreateRemoteWorkspace,
    handleCreateTaskInWorkspace,
    handleCreateWorkspace,
    handleForgetWorkspace,
    handleOpenCreateWorkspace,
    handleOpenRenameWorkspace,
    handleOpenSettings,
    handleReorderWorkspaces,
    handleRevealWorkspace,
    handleRuntimeSessionUpdated,
    handleRuntimeSessionStatus,
    handleSaveRenameWorkspace,
    handleSaveShareRemoteAccess,
    handleShareWorkspace,
    handleSignOut,
    handleExportWorkspaceConfig,
    loadWorkspaceSessionsInBackground,
    local,
    modelPickerOpen,
    modelPickerQuery,
    navigate,
    navigateToWorkspaceSession,
    onmyagentServerSettings,
    opencodeBaseUrl,
    opencodeClient,
    pageMode,
    paletteAccessibleTargets,
    paletteSessionOptions,
    permissionReplyBusy,
    providerConnectedIds,
    providers,
    questionReplyBusy,
    refreshRouteState,
    rememberPendingCreatedSession,
    remoteAccessRestart,
    remoteWorkspaceConnectionEditor,
    renameWorkspaceBusy,
    renameWorkspaceId,
    renameWorkspaceTitle,
    respondPermission,
    respondQuestion,
    routeNotFoundMessage,
    runRemoteWorkspaceConnectionCheck,
    selectedSessionFileRoot,
    selectedSessionId,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceError,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedWorkspaceServerToken,
    isExpertSessionInDirectory,
    sessionMatchesPageMode,
    sessionProviderAuthSnapshot,
    sessionProviderAuthStore,
    sessionsByWorkspaceId,
    sessionsByWorkspaceIdRef,
    sessionWorkspaceRoot,
    setCommandPaletteOpen,
    setCreateWorkspaceError,
    setCreateWorkspaceOpen,
    setDisabledProviderIds,
    setLegacySelectedWorkspaceId,
    setModelPickerOpen,
    setModelPickerQuery,
    setPaletteAccessibleTargets,
    setRecentProviderIds,
    setRenameWorkspaceId,
    setRenameWorkspaceTitle,
    setRetryingWorkspaceIds,
    setSessionsByWorkspaceId,
    setSidebarAccount,
    shareWorkspaceState,
    showPreparingStatus,
    sidebarAccount,
    sidebarSessionStatusById,
    surfaceProps,
    suppressRestoreSessionRef,
    token,
    visibleTodos,
    workspaceConnectionStateById,
    workspaceSessionGroups,
    workspaces,
  } = props;
  const [optimisticSidebarSelection, setOptimisticSidebarSelection] = useState<{
    workspaceId: string;
    sessionId: string | null;
  } | null>(null);

  useEffect(() => {
    if (!optimisticSidebarSelection) return;
    if (
      optimisticSidebarSelection.workspaceId === selectedWorkspaceId &&
      optimisticSidebarSelection.sessionId === selectedSessionId
    ) {
      setOptimisticSidebarSelection(null);
    }
  }, [optimisticSidebarSelection, selectedSessionId, selectedWorkspaceId]);

  const sidebarSelectedWorkspaceId =
    optimisticSidebarSelection?.workspaceId ?? selectedWorkspaceId;
  const sidebarSelectedSessionId =
    optimisticSidebarSelection?.sessionId ?? selectedSessionId;

  const platform = usePlatform();

  return (
    <CloudSessionProvider>
      <SessionCloudAccountBridge
        developerMode={developerMode}
        onAccountChange={setSidebarAccount}
      />
      <WorkspaceProvider
        client={opencodeClient}
        opencodeBaseUrl={opencodeBaseUrl}
        selectedWorkspaceRoot={sessionWorkspaceRoot}
      >
        {opencodeClient &&
        selectedWorkspaceEndpoint &&
        opencodeBaseUrl &&
        selectedWorkspaceServerToken ? (
          <ReactSessionRuntime
            // Use the server-side workspace id (the one without the `rem_`
            // prefix) so the React Query cache keys session-sync writes match
            // the keys SessionSurface reads from. Otherwise events arrive but
            // the UI never sees them and gets stuck on "thinking".
            workspaceId={selectedWorkspaceEndpoint.workspaceId}
            sessionId={selectedSessionId}
            activeSessionIds={activeSelectedWorkspaceSessionIds}
            directory={sessionWorkspaceRoot}
            opencodeBaseUrl={opencodeBaseUrl}
            onmyagentToken={selectedWorkspaceServerToken}
            onSessionUpdated={handleRuntimeSessionUpdated}
            onSessionStatus={handleRuntimeSessionStatus}
          />
        ) : null}
        <SessionPage
          mode={pageMode}
          agentManagementIntent={agentManagementIntent}
          onAgentManagementIntentConsumed={clearAgentManagementIntent}
          onNavigateToMode={(targetMode) => {
            // User mode switch must push history so Back can return to the prior mode.
            // Session choice still uses mode-scoped last-session memory for the target path.
            // Clear secondary rail bookmarks (files/store/…) for the *target* mode so
            // remounting Assistant/Expert does not re-open 文件 after 助理↔专家.
            if (selectedWorkspaceId) {
              resetRailBookmarkToPrimary(targetMode, selectedWorkspaceId);
            }
            const path = resolveSessionRouteModeSwitchPath({
              currentMode: pageMode,
              findFirstSessionIdMatching,
              isExpertSessionInDirectory,
              readLastSessionFor,
              sessionListOwnsSession,
              sessionsByWorkspaceId,
              targetMode,
              workspaceId: selectedWorkspaceId,
            });
            if (path) navigate(path);
          }}
          selectedSessionId={selectedSessionId}
          selectedWorkspaceId={selectedWorkspaceId}
          selectedWorkspaceDisplay={
            selectedWorkspace
              ? {
                  id: selectedWorkspace.id,
                  name: selectedWorkspace.name ?? undefined,
                  displayName: selectedWorkspace.displayNameResolved,
                  workspaceType: selectedWorkspace.workspaceType,
                }
              : { workspaceType: "local" }
          }
          selectedWorkspaceRoot={sessionWorkspaceRoot}
          // True registry workspace path — Files rail must not use session-scoped root.
          workspaceFilesRoot={selectedWorkspaceRoot}
          selectedSessionFileRoot={selectedSessionFileRoot}
          selectedWorkspaceError={selectedWorkspaceError}
          runtimeWorkspaceId={selectedWorkspaceEndpoint?.workspaceId || null}
          opencodeBaseUrl={opencodeBaseUrl}
          workspaces={workspaces}
          clientConnected={canCreateTask}
          onmyagentServerStatus={client ? "connected" : "disconnected"}
          onmyagentServerClient={selectedWorkspaceEndpoint?.client ?? client}
          onmyagentServerToken={selectedWorkspaceServerToken}
          developerMode={developerMode}
          headerStatus={
            canCreateTask
              ? t("status.connected")
              : t("system.load_session_route")
          }
          // While the full-screen boot overlay is up, skip busyHint so users
          // do not read the same load copy twice (overlay + header chrome).
          busyHint={
            bootOverlayVisible
              ? null
              : effectiveLoading
                ? t("system.load_session_route")
                : null
          }
          startupPhase={effectiveLoading ? "nativeInit" : "ready"}
          coldBootShell={coldBootShell}
          onStaticHomeReady={markRouteReady}
          providerConnectedIds={providerConnectedIds}
          providers={providers}
          renderAgentsPage={(agentsPageProps) => (
            <Suspense fallback={null}>
              <AgentsPage {...agentsPageProps} />
            </Suspense>
          )}
          taskCenterSlot={
            <TaskCenterPage workspaceRoot={selectedWorkspaceRoot} />
          }
          mcpConnectedCount={0}
          onSendFeedback={() => {
            platform.openLink(
              buildFeedbackUrl({
                entrypoint: "status-bar",
              }),
            );
          }}
          onOpenSettings={() => handleOpenSettings("/settings/general")}

          providerAuthModal={
            sessionProviderAuthSnapshot.providerAuthModalOpen
              ? {
                  open: true,
                  loading: false,
                  submitting: sessionProviderAuthSnapshot.providerAuthBusy,
                  error: sessionProviderAuthSnapshot.providerAuthError,
                  preferredProviderId:
                    sessionProviderAuthSnapshot.providerAuthPreferredProviderId,
                  workerType:
                    sessionProviderAuthSnapshot.providerAuthWorkerType,
                  providers:
                    sessionProviderAuthSnapshot.providerAuthProviders.filter(
                      (provider) =>
                        !isDesktopProviderBlocked({
                          providerId: provider.id,
                          checkRestriction: checkDesktopRestriction,
                        }),
                    ),
                  connectedProviderIds: providerConnectedIds,
                  authMethods: Object.fromEntries(
                    Object.entries(
                      sessionProviderAuthSnapshot.providerAuthMethods,
                    ).filter(
                      ([providerId]) =>
                        !isDesktopProviderBlocked({
                          providerId,
                          checkRestriction: checkDesktopRestriction,
                        }),
                    ),
                  ),
                  onSelect: sessionProviderAuthStore.startProviderAuth,
                  onSubmitApiKey: sessionProviderAuthStore.submitProviderApiKey,
                  onConnectCloudProvider:
                    sessionProviderAuthStore.connectCloudProvider,
                  onSubmitOAuth:
                    sessionProviderAuthStore.completeProviderAuthOAuth,
                  onRefreshProviders: sessionProviderAuthStore.refreshProviders,
                  onClose: () =>
                    sessionProviderAuthStore.closeProviderAuthModal(),
                }
              : null
          }
          settingsSlot={
            <SettingsSurface
              embedded
              initialPath="general"
              workspaceId={selectedWorkspaceId}
              onClose={() => {
                try {
                  window.dispatchEvent(
                    new CustomEvent("onmyagent-close-right-pane"),
                  );
                } catch {
                  // ignore
                }
              }}
            />
          }
          onCreateSessionForAgent={() => {
            forceNewSessionOnNextSendRef.current = true;
          }}
          onCreateFreshSessionForAgent={async (workspaceId) => {
            // Called when the user clicks "+ conversation" on an agent that is NOT yet
            // present in the left-side agent list. We must create a real
            // session right now (so the new agent is visible on the left as
            // soon as we navigate to that session).
            if (!opencodeClient) return;
            if (creatingSessionWorkspaceIdsRef.current.has(workspaceId)) return;
            creatingSessionWorkspaceIdsRef.current.add(workspaceId);
            let newSession: {
              id: string;
              title?: string;
              time?: unknown;
              directory?: string;
            } | null = null;
            const pendingAgentSnapshot =
              usePendingAgentStore.getState().getAgent();
            let bindDirectory = "";
            try {
              const workspaceRoot = selectedWorkspaceRoot?.trim() || "";
              const draftRoot =
                surfaceProps?.draftWorkspace?.draftWorkspaceDirectory?.trim() || "";
              let sessionDirectory = draftRoot || workspaceRoot || undefined;
              bindDirectory = draftRoot;
              // Treat empty draft and "draft == workspace root" as no real folder pick.
              // Default sessions must bind to the external runtime-state directory.
              if (shouldIsolateExpertSessionDirectory(workspaceRoot, draftRoot)) {
                const agentName =
                  pendingAgentSnapshot?.name?.trim() || "expert";
                const agentId = pendingAgentSnapshot?.id?.trim() || "";
                const packageName = normalizeExpertWritePackageName({
                  agentId,
                  packageName: pendingAgentSnapshot?.marketplaceExpert?.packageName,
                });
                const approvedAgentIds =
                  pendingAgentSnapshot?.approvedAgentIds ?? [];
                const skillNames = pendingAgentSnapshot?.skillIds ?? [];
                const ensureWorkspaceId =
                  selectedWorkspaceEndpoint?.workspaceId ?? workspaceId;
                // A+B: claim draft prewarm or create under global cold queue.
                const cold = await claimOrCreateExpertColdSession(
                  {
                    workspaceId: ensureWorkspaceId,
                    agentId,
                    agentName,
                    packageName,
                    approvedAgentIds,
                    skillNames,
                  },
                  {
                    createIsolatedDirectory: () =>
                      createIsolatedExpertSessionRuntimeDirectory({
                        client: selectedWorkspaceEndpoint?.client ?? client,
                        workspaceId: ensureWorkspaceId,
                        workspaceRoot,
                        agentName,
                        agentId,
                        packageName,
                        approvedAgentIds,
                        skillNames,
                      }),
                    createSession: async (directory) => {
                      const created = unwrap(
                        await opencodeClient.session.create({ directory }),
                      );
                      return { id: created.id };
                    },
                  },
                );
                sessionDirectory = cold.directory;
                bindDirectory = cold.directory;
                newSession = {
                  id: cold.sessionId,
                  directory: cold.directory,
                };
              } else {
                newSession = unwrap(
                  await opencodeClient.session.create({
                    directory: sessionDirectory,
                  }),
                );
                newSession.directory = sessionDirectory;
              }
              // Do NOT startRun here: this path only opens an empty expert
              // session shell. Marking runActive without a prompt leaves the
              // transcript stuck on "准备中 / thinking" forever (no messages,
              // never idle). Real runs start when the first draft is sent.
            } finally {
              creatingSessionWorkspaceIdsRef.current.delete(workspaceId);
            }
            if (!newSession) return;

            // Bind the pending agent to this new session (so it appears with
            // the agent avatar + system prompt when user sends first message).
            // If the store is empty (e.g. race after navigation), inherit from
            // the session the user was viewing so we never land on the default agent.
            const { pendingAgentSnapshot: agentToBind } =
              resolvePendingAgentForPrompt({
                currentAgent:
                  usePendingAgentStore.getState().getAgent() ??
                  pendingAgentSnapshot,
                createdSession: true,
                sessionId: newSession.id,
                inheritFromSessionId: selectedSessionId,
                inheritAgentId: selectedSessionId
                  ? useExpertDirectoryStore
                      .getState()
                      .getIdentity(workspaceId)
                      .agentIdBySessionId.get(selectedSessionId)
                  : null,
              });
            if (agentToBind) {
              usePendingAgentStore.getState().setAgent(
                bindPendingAgentToSession({
                  agent: agentToBind,
                  sessionId: newSession.id,
                }),
              );
              useExpertDirectoryStore
                .getState()
                .upsertIdentity(workspaceId, newSession.id, agentToBind.id);
              writeSessionAgentSnapshot(newSession.id, agentToBind);
              // Empty session shell: do not block navigation/UI on package
              // install. First prompt (and summon) join the same coordinator.
              void installMarketplaceExpertAfterSessionCreated(agentToBind);
            }
            if (bindDirectory) {
              writeAssistantSessionWorkspace({
                sessionId: newSession.id,
                ownerWorkspaceId: workspaceId,
                directory: bindDirectory,
              });
              dispatchAssistantSessionWorkspacesChanged(workspaceId);
            }

            const markerClient = selectedWorkspaceEndpoint?.client ?? client;
            const markerWorkspaceId = selectedWorkspaceEndpoint?.workspaceId ?? workspaceId;
            const markerAgentId = agentToBind?.id?.trim() || undefined;
            const markerPackageName = markerAgentId
              ? normalizeExpertWritePackageName({
                  agentId: markerAgentId,
                  packageName: agentToBind?.marketplaceExpert?.packageName,
                })
              : undefined;
            if (newSession.directory && markerClient) {
              try {
                await markerClient.ensureExpertSessionIsolation(markerWorkspaceId, {
                  directory: newSession.directory,
                  agentId: markerAgentId,
                  packageName: markerPackageName,
                  sessionId: newSession.id,
                  approvedAgentIds: agentToBind?.approvedAgentIds ?? [],
                });
              } catch (error) {
                console.warn("[expert-session] marker identity upgrade failed", error);
              }
            }
            // Await durable origin so reload recovery has agentId + directory.
            // Do not block navigation on the promise beyond microtask settle.
            void writeSessionOriginDurable({
              client: selectedWorkspaceEndpoint?.client ?? client,
              workspaceId: selectedWorkspaceEndpoint?.workspaceId ?? workspaceId,
              sessionId: newSession.id,
              kind: "expert",
              agentId: agentToBind?.id,
              packageName: agentToBind
                ? normalizeExpertWritePackageName({
                    agentId: agentToBind.id,
                    packageName: agentToBind.marketplaceExpert?.packageName,
                  })
                : undefined,
              directory: newSession.directory,
            }).then(() =>
              getReactQueryClient().invalidateQueries({
                queryKey: ["expert-directory", workspaceId],
              }),
            );

            // Optimistically append the new session into the workspace list
            // so the left-side agent panel renders the new agent immediately.
            setLegacySelectedWorkspaceId(workspaceId);
            writeActiveWorkspaceId(workspaceId || null);
            writeLastSessionFor(workspaceId, newSession.id, pageMode);
            rememberPendingCreatedSession(workspaceId, newSession.id);
            setSessionsByWorkspaceId((current) => {
              const next = insertSidebarSession({
                current,
                workspaceId,
                session: newSession,
                pageMode: "expert",
                // Directory-derived identity was optimistically upserted above.
                registerPageMode: false,
              });
              sessionsByWorkspaceIdRef.current = next;
              return next;
            });
            setOptimisticSidebarSelection({
              workspaceId,
              sessionId: newSession.id,
            });
            navigateToWorkspaceSession(workspaceId, newSession.id);
            focusPromptSoon();
            void refreshRouteState();
          }}
          sidebar={{
            workspaceSessionGroups,
            selectedWorkspaceId: sidebarSelectedWorkspaceId,
            selectedSessionId: sidebarSelectedSessionId,
            developerMode: false,
            sessionStatusById: sidebarSessionStatusById,
            connectingWorkspaceId: null,
            workspaceConnectionStateById,
            // New-task opens a local draft and remains available while
            // background session-list/model readiness is recovering.
            newTaskDisabled: !workspaces.some(
              (workspace) => workspace.id === selectedWorkspaceId,
            ),
            sidebarHydratedFromCache: Object.values(sessionsByWorkspaceId).some(
              (list) => list.length > 0,
            ),
            startupPhase: effectiveLoading ? "nativeInit" : "ready",
            onSelectWorkspace: async (workspaceId) => {
              if (workspaceId === selectedWorkspaceId) return true;
              setLegacySelectedWorkspaceId(workspaceId);
              writeActiveWorkspaceId(workspaceId || null);
              const workspace = workspaces.find(
                (item) => item.id === workspaceId,
              );
              if (
                client &&
                workspace &&
                !sessionsByWorkspaceId[workspaceId]?.length
              ) {
                setRetryingWorkspaceIds((current) =>
                  Array.from(new Set([...current, workspaceId])),
                );
                void loadWorkspaceSessionsInBackground([workspace]);
              }
              // Fire desktop IPC updates but don't await them — they're bookkeeping and
              // awaiting 2 IPC roundtrips on every click used to stall rapid
              // workspace switches behind a queue.
              activateDesktopSessionWorkspaceInBackground(workspaceId);
              // Tell the OnMyAgent server this workspace is now active so it can
              // emit a config reload event that the OpenCode engine picks up.
              // Without this, the permissions from opencode.jsonc are never
              // applied on the workspace the user is already on at launch. See
              // issue #870.
              if (workspaceId && client) {
                const routeWorkspace = findRouteWorkspace(
                  workspaces,
                  workspaceId,
                );
                const endpoint = endpointForWorkspace(routeWorkspace);
                if (endpoint) {
                  void endpoint.client
                    .activateWorkspace(endpoint.workspaceId)
                    .catch(() => undefined);
                }
              }
              const targetSessionId = resolveWorkspaceSelectionSessionTarget({
                firstSessionIdForPageMode,
                pageMode,
                readLastSessionFor,
                selectedSessionId,
                sessionMatchesPageMode,
                sessionsByWorkspaceId,
                workspaceId,
              });
              setOptimisticSidebarSelection({
                workspaceId,
                sessionId: targetSessionId,
              });
              navigateToWorkspaceSession(workspaceId, targetSessionId);
              return true;
            },
            onOpenSession: (workspaceId, sessionId) => {
              setOptimisticSidebarSelection({ workspaceId, sessionId });
              setLegacySelectedWorkspaceId(workspaceId);
              writeActiveWorkspaceId(workspaceId || null);
              writeLastSessionFor(workspaceId, sessionId, pageMode);
              navigateToWorkspaceSession(workspaceId, sessionId);
            },
            onPrefetchSession: (workspaceId, sessionId) => {
              // Warm the same snapshot query SessionSurface reads so hover/focus
              // before open can hit cache instead of a cold getSessionSnapshot.
              const workspace = workspaces.find(
                (item) => item.id === workspaceId,
              );
              if (!workspace) return;
              const row = (sessionsByWorkspaceId[workspaceId] ?? []).find(
                (item) => item.id === sessionId,
              );
              const titleEmpty = !(row?.title ?? "").trim();
              const isSelectedSession =
                workspaceId === selectedWorkspaceId &&
                sessionId === selectedSessionId;
              // Cold-path thrash ban: empty selected chips must not prefetch.
              if (
                !shouldPrefetchSessionSnapshotOnColdPath({
                  isSelectedSession,
                  titleEmpty,
                })
              ) {
                return;
              }
              const endpoint = resolveWorkspaceEndpoint(workspace, {
                baseUrl,
                token,
              });
              if (!endpoint) return;
              const directory = workspace.path?.trim() || undefined;
              const spec = buildSessionSnapshotPrefetchSpec({
                // Server-side id (no rem_ prefix) must match SessionSurface keys.
                workspaceId: endpoint.workspaceId,
                sessionId,
                directory,
                staleTimeMs: SESSION_SNAPSHOT_STALE_TIME_MS,
              });
              void getReactQueryClient().prefetchQuery({
                queryKey: spec.queryKey,
                staleTime: spec.staleTime,
                queryFn: ({ signal }) =>
                  scheduleSessionSnapshot({
                    workspaceId: endpoint.workspaceId,
                    requestKey: `${sessionId}:${directory ?? ""}`,
                    priority: "prefetch",
                    signal,
                    run: async (requestSignal) =>
                      (
                        await endpoint.client.getSessionSnapshot(
                          endpoint.workspaceId,
                          sessionId,
                          { ...spec.fetchOptions, signal: requestSignal },
                        )
                      ).item,
                  }),
              });
            },
            onCreateTaskInWorkspace: (workspaceId) => {
              void handleCreateTaskInWorkspace(workspaceId);
            },
            onCreateTaskWithPrompt: (workspaceId, prompt) => {
              void (async () => {
                const workspace = workspaces.find(
                  (item) => item.id === workspaceId,
                );
                if (!workspace) return;
                const endpoint = resolveWorkspaceEndpoint(workspace, {
                  baseUrl,
                  token,
                });
                if (!endpoint?.token) return;
                const workspaceClient = createClient(
                  endpoint.opencodeBaseUrl,
                  workspace.path?.trim() || undefined,
                  { token: endpoint.token, mode: "onmyagent" },
                );
                try {
                  const session = unwrap(
                    await workspaceClient.session.create({
                      directory: workspace.path?.trim() || undefined,
                    }),
                  );
                  // Composer reads Zustand store — saveSessionDraft alone is not enough.
                  const { useComposerStateStore } = await import(
                    "../../domains/session"
                  );
                  const seed = () =>
                    useComposerStateStore
                      .getState()
                      .setDraft(session.id, prompt);
                  seed();
                  window.setTimeout(seed, 0);
                  window.setTimeout(seed, 120);
                  window.setTimeout(seed, 200);
                  saveSessionDraft(workspaceId, session.id, {
                    text: prompt,
                    mode: "prompt",
                  });
                  writeActiveWorkspaceId(workspaceId || null);
                  writeLastSessionFor(workspaceId, session.id, pageMode);
                  rememberPendingCreatedSession(workspaceId, session.id);
                  setSessionsByWorkspaceId((current) =>
                    insertSidebarSession({
                      current,
                      workspaceId,
                      session,
                      pageMode,
                    }),
                  );
                  navigateToWorkspaceSession(workspaceId, session.id);
                  focusPromptSoon();
                } catch {
                  // Fall back to normal task creation without prompt
                  void handleCreateTaskInWorkspace(workspaceId);
                }
              })();
            },
            onOpenRenameWorkspace: handleOpenRenameWorkspace,
            onShareWorkspace: handleShareWorkspace,
            onRevealWorkspace: (id) => void handleRevealWorkspace(id),
            onRecoverWorkspace: (workspaceId) =>
              runRemoteWorkspaceConnectionCheck(workspaceId, "recover"),
            onTestWorkspaceConnection: (workspaceId) =>
              runRemoteWorkspaceConnectionCheck(workspaceId, "test"),
            onEditWorkspaceConnection: remoteWorkspaceConnectionEditor.open,
            onForgetWorkspace: (id) => void handleForgetWorkspace(id),
            onOpenCreateWorkspace: handleOpenCreateWorkspace,
            onReorderWorkspaces: handleReorderWorkspaces,
          }}
          surface={surfaceProps}
          history={{
            canUndo: false,
            canRedo: false,
            busyAction: null,
            onUndo: () => {},
            onRedo: () => {},
          }}
          todos={visibleTodos}
          sessionLoadingById={(sessionId) =>
            effectiveLoading &&
            Boolean(sessionId && sessionId === selectedSessionId)
          }
          shareWorkspaceModal={
            shareWorkspaceState.shareWorkspaceOpen
              ? {
                  open: true,
                  onClose: shareWorkspaceState.closeShareWorkspace,
                  workspaceName: shareWorkspaceState.shareWorkspaceName,
                  workspaceDetail: shareWorkspaceState.shareWorkspaceDetail,
                  fields: shareWorkspaceState.shareFields,
                  remoteAccess:
                    isDesktopRuntime() &&
                    shareWorkspaceState.shareWorkspace?.workspaceType ===
                      "local"
                      ? {
                          enabled:
                            onmyagentServerSettings.remoteAccessEnabled ===
                            true,
                          busy: remoteAccessRestart.busy,
                          error: remoteAccessRestart.error,
                          status: remoteAccessRestart.status,
                          onSave: handleSaveShareRemoteAccess,
                        }
                      : undefined,
                  note: shareWorkspaceState.shareNote,
                  onExportConfig:
                    shareWorkspaceState.exportDisabledReason === null
                      ? () => {
                          const id = shareWorkspaceState.shareWorkspaceId;
                          if (!id) return;
                          void handleExportWorkspaceConfig(id);
                        }
                      : undefined,
                  exportDisabledReason:
                    shareWorkspaceState.exportDisabledReason,
                }
              : null
          }
          activePermission={activePermission}
          permissionReplyBusy={permissionReplyBusy}
          respondPermission={respondPermission}
          autoApprovedPermissionNoticeId={
            selectedSessionId
              ? (autoApprovedPermissionNoticeBySessionId[selectedSessionId] ??
                null)
              : null
          }
          activeQuestion={activeQuestion}
          questionReplyBusy={questionReplyBusy}
          respondQuestion={respondQuestion}
          safeStringify={safeStringify}
          onRenameSession={
            opencodeClient
              ? async (sessionId, nextTitle) => {
                  const trimmed = nextTitle.trim();
                  if (!trimmed) return;
                  const assistantSessionWorkspace =
                    readAssistantSessionWorkspace(sessionId);
                  await opencodeClient.session.update({
                    sessionID: sessionId,
                    title: trimmed,
                    directory:
                      assistantSessionWorkspace?.directory ||
                      selectedWorkspaceRoot ||
                      undefined,
                  });
                  if (assistantSessionWorkspace?.ownerWorkspaceId) {
                    renameAutomationSessionRecord(
                      assistantSessionWorkspace.ownerWorkspaceId,
                      sessionId,
                      trimmed,
                    );
                  }
                  await refreshRouteState();
                }
              : undefined
          }
          onDeleteSession={
            client && selectedWorkspaceId
              ? async (sessionId) => {
                  const endpoint = endpointForWorkspace(selectedWorkspace);
                  const assistantSessionWorkspace =
                    readAssistantSessionWorkspace(sessionId);
                  const listedDirectory =
                    sessionsByWorkspaceId[selectedWorkspaceId]?.find(
                      (item) => item.id === sessionId,
                    )?.directory ?? null;
                  const directory = resolveSessionDeleteDirectory({
                    assistantDirectory: assistantSessionWorkspace?.directory,
                    // Expert isolated dirs live on the sidebar item, not assistant map.
                    sessionDirectory: listedDirectory,
                    workspaceRoot:
                      selectedWorkspaceRoot ||
                      selectedWorkspace?.path ||
                      null,
                  });

                  // 1) Local-first: tombstone + optimistic remove so dirty rows
                  // leave the UI even if remote DELETE hangs for 12s.
                  markSessionRecentlyDeleted(sessionId);
                  registerPendingSessionDelete({
                    workspaceId: selectedWorkspaceId,
                    sessionId,
                    ...(directory ? { directory } : {}),
                  });
                  let nextListForCache: SidebarSessionItem[] | null = null;
                  setSessionsByWorkspaceId((current) => {
                    const list = current[selectedWorkspaceId];
                    if (!list?.some((item) => item.id === sessionId)) {
                      return current;
                    }
                    const nextList = list.filter(
                      (item) => item.id !== sessionId,
                    );
                    nextListForCache = nextList;
                    return {
                      ...current,
                      [selectedWorkspaceId]: nextList,
                    };
                  });
                  if (nextListForCache) {
                    writeCachedSidebarSessionsForWorkspace(
                      selectedWorkspaceId,
                      nextListForCache,
                      { clearWhenEmpty: true },
                    );
                  }

                  removeAssistantSession(sessionId);
                  writeCustomAgentIdForSession(sessionId, null);
                  writeSessionAgentSnapshot(sessionId, null);
                  if (assistantSessionWorkspace?.ownerWorkspaceId) {
                    removeAutomationSessionRecord(
                      assistantSessionWorkspace.ownerWorkspaceId,
                      sessionId,
                    );
                  }
                  removeAssistantSessionWorkspace(sessionId);
                  if (assistantSessionWorkspace?.ownerWorkspaceId) {
                    dispatchAssistantSessionWorkspacesChanged(
                      assistantSessionWorkspace.ownerWorkspaceId,
                    );
                  }
                  if (selectedSessionId === sessionId) {
                    navigateToWorkspaceSession(selectedWorkspaceId);
                  }

                  // 2) Remote best-effort with a short UI budget (not full 12s
                  // client timeout) so the confirm dialog never sticks.
                  if (endpoint) {
                    const remote = executePendingSessionDelete({
                      workspaceId: selectedWorkspaceId,
                      remoteWorkspaceId: endpoint.workspaceId,
                      sessionId,
                      client: endpoint.client,
                    }).catch((error: unknown) => {
                        if (!isTolerableSessionDeleteFailure(error)) {
                          console.warn(
                            "[session-route] deleteSession remote failed; local cleanup already done",
                            sessionId,
                            error,
                          );
                        } else {
                          console.warn(
                            "[session-route] deleteSession ignored missing/failed session",
                            sessionId,
                            error,
                          );
                        }
                        void retryPendingSessionDeletesForWorkspace({
                          workspaceId: selectedWorkspaceId,
                          remoteWorkspaceId: endpoint.workspaceId,
                          client: endpoint.client,
                        });
                      });
                    await raceSessionDeleteRemote(
                      remote,
                      SESSION_DELETE_REMOTE_BUDGET_MS,
                    );
                  }

                  // 3) Refresh in background; tombstones keep ghosts out.
                  void Promise.resolve(refreshRouteState()).catch((error) => {
                    console.warn(
                      "[session-route] refresh after delete failed",
                      sessionId,
                      error,
                    );
                  });
                }
              : undefined
          }
          statusBar={{ loading: showPreparingStatus }}
          notFoundMessage={routeNotFoundMessage}
          onAccessibleTargetsChange={setPaletteAccessibleTargets}
          account={sidebarAccount}
          onOpenAccountSettings={() =>
            handleOpenSettings("/settings/general")
          }
          onOpenProfile={() => handleOpenSettings("/settings/memory")}
          onSignOut={handleSignOut}
        />
        <SessionRouteModals
          createWorkspaceOpen={createWorkspaceOpen}
          setCreateWorkspaceOpen={setCreateWorkspaceOpen}
          setCreateWorkspaceError={setCreateWorkspaceError}
          handleCreateWorkspace={handleCreateWorkspace}
          handleCreateRemoteWorkspace={handleCreateRemoteWorkspace}
          createWorkspaceBusy={createWorkspaceBusy}
          createWorkspaceError={createWorkspaceError}
          createWorkspaceRemoteBusy={createWorkspaceRemoteBusy}
          createWorkspaceRemoteError={createWorkspaceRemoteError}
          remoteWorkspaceConnectionEditor={remoteWorkspaceConnectionEditor}
          renameWorkspaceId={renameWorkspaceId}
          renameWorkspaceTitle={renameWorkspaceTitle}
          renameWorkspaceBusy={renameWorkspaceBusy}
          setRenameWorkspaceId={setRenameWorkspaceId}
          setRenameWorkspaceTitle={setRenameWorkspaceTitle}
          handleSaveRenameWorkspace={handleSaveRenameWorkspace}
          commandPaletteOpen={commandPaletteOpen}
          setCommandPaletteOpen={setCommandPaletteOpen}
          selectedWorkspaceId={selectedWorkspaceId}
          handleCreateTaskInWorkspace={handleCreateTaskInWorkspace}
          navigateToWorkspaceSession={navigateToWorkspaceSession}
          handleOpenSettings={handleOpenSettings}
          paletteAccessibleTargets={paletteAccessibleTargets}
          paletteSessionOptions={paletteSessionOptions}
          modelPickerOpen={modelPickerOpen}
          setModelPickerOpen={setModelPickerOpen}
          allowedModelOptions={allowedModelOptions}
          modelPickerQuery={modelPickerQuery}
          setModelPickerQuery={setModelPickerQuery}
          defaultModel={local.prefs.defaultModel}
          setPrefs={local.setPrefs}
          disabledProviderIds={disabledProviderIds}
          setDisabledProviderIds={setDisabledProviderIds}
          setRecentProviderIds={setRecentProviderIds}
          opencodeClient={opencodeClient}
        />
      </WorkspaceProvider>
    </CloudSessionProvider>
  );
}
