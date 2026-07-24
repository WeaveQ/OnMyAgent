/** @jsxImportSource react */
/**
 * Presentational shell for SessionRouteRender: CloudSessionProvider,
 * WorkspaceProvider, ReactSessionRuntime, SessionPage, and SessionRouteModals.
 */
import {
  lazy,
  Suspense,
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
import {
  SessionPage,
  type PageMode,
  type SessionAgentManagementIntent,
} from "../../domains/session";
import { resetRailBookmarkToPrimary } from "../../domains/session/pages/use-rail-location";
import type { SessionPageSurfaceProps } from "../../domains/session";

import { loadAgentsPage } from "../../domains/agents";

// Agents registry UI is heavy and non-critical for the live chat path —
// code-split so it does not ride the main session graph.
const AgentsPage = lazy(() =>
  loadAgentsPage().then((module) => ({
    default: module.AgentsPage,
  })),
);
import { isDesktopProviderBlocked } from "../../../app/cloud/desktop-app-restrictions";
import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import { ReactSessionRuntime, useSessionActivityStore } from "../../domains/session";
import { usePendingAgentStore } from "../../domains/agents";
import {
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "../../domains/agents";
import {
  addExpertSession,
  isExpertSession,
  removeAssistantSession,
  removeExpertSession,
} from "../../domains/agents";
import {
  removeAutomationSessionRecord,
  renameAutomationSessionRecord,
} from "../../domains/session";
import {
  buildIsolatedExpertSessionDirectory,
  dispatchAssistantSessionWorkspacesChanged,
  materializeExpertSessionDirectory,
  readAssistantSessionWorkspace,
  removeAssistantSessionWorkspace,
  saveSessionDraft,
  shouldIsolateExpertSessionDirectory,
  writeAssistantSessionWorkspace,
} from "../../domains/session";
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
              isExpertSession,
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
            canCreateTask ? t("status.connected") : t("session.loading_detail")
          }
          busyHint={effectiveLoading ? t("session.loading_detail") : null}
          startupPhase={effectiveLoading ? "nativeInit" : "ready"}
          providerConnectedIds={providerConnectedIds}
          providers={providers}
          renderAgentsPage={(agentsPageProps) => (
            <Suspense fallback={null}>
              <AgentsPage {...agentsPageProps} />
            </Suspense>
          )}
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
            const workspaceRoot = selectedWorkspaceRoot?.trim() || "";
            const draftRoot =
              surfaceProps?.draftWorkspace?.draftWorkspaceDirectory?.trim() || "";
            let sessionDirectory = draftRoot || workspaceRoot || undefined;
            let bindDirectory = draftRoot || "";
            // Treat empty draft and "draft == workspace root" as no real folder pick.
            // Only bind isolated path when materialize succeeds (opencode realPath).
            if (shouldIsolateExpertSessionDirectory(workspaceRoot, draftRoot)) {
              const isolated = buildIsolatedExpertSessionDirectory({
                workspaceRoot,
                agentName: pendingAgentSnapshot?.name?.trim() || "expert",
                agentId: pendingAgentSnapshot?.id?.trim() || "",
              });
              const ensureClient = selectedWorkspaceEndpoint?.client ?? client;
              const ensureWorkspaceId =
                selectedWorkspaceEndpoint?.workspaceId ?? workspaceId;
              const created = await materializeExpertSessionDirectory({
                client: ensureClient,
                workspaceId: ensureWorkspaceId,
                workspaceRoot,
                sessionDirectory: isolated.directory,
              });
              if (created) {
                sessionDirectory = isolated.directory;
                bindDirectory = isolated.directory;
              } else {
                sessionDirectory = workspaceRoot || undefined;
                bindDirectory = "";
              }
            }
            try {
              newSession = unwrap(
                await opencodeClient.session.create({
                  directory: sessionDirectory,
                }),
              );
              newSession.directory = sessionDirectory;
              useSessionActivityStore
                .getState()
                .startRun(workspaceId, newSession.id);
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
              });
            if (agentToBind) {
              usePendingAgentStore.getState().setAgent(
                bindPendingAgentToSession({
                  agent: agentToBind,
                  sessionId: newSession.id,
                }),
              );
              writeCustomAgentIdForSession(newSession.id, agentToBind.id);
              writeSessionAgentSnapshot(newSession.id, agentToBind);
              await installMarketplaceExpertAfterSessionCreated(agentToBind);
            }
            if (bindDirectory) {
              writeAssistantSessionWorkspace({
                sessionId: newSession.id,
                ownerWorkspaceId: workspaceId,
                directory: bindDirectory,
              });
              dispatchAssistantSessionWorkspacesChanged(workspaceId);
            }

            addExpertSession(newSession.id);

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
              });
              sessionsByWorkspaceIdRef.current = next;
              return next;
            });
            navigateToWorkspaceSession(workspaceId, newSession.id);
            focusPromptSoon();
            void refreshRouteState();
          }}
          sidebar={{
            workspaceSessionGroups,
            selectedWorkspaceId,
            selectedSessionId,
            developerMode: false,
            sessionStatusById: sidebarSessionStatusById,
            connectingWorkspaceId: null,
            workspaceConnectionStateById,
            newTaskDisabled: !canCreateTask,
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
              navigateToWorkspaceSession(workspaceId, targetSessionId);
              return true;
            },
            onOpenSession: (workspaceId, sessionId) => {
              setLegacySelectedWorkspaceId(workspaceId);
              writeActiveWorkspaceId(workspaceId || null);
              writeLastSessionFor(workspaceId, sessionId, pageMode);
              navigateToWorkspaceSession(workspaceId, sessionId);
            },
            onPrefetchSession: () => {},
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
                  if (!endpoint) return;
                  const assistantSessionWorkspace =
                    readAssistantSessionWorkspace(sessionId);
                  await endpoint.client.deleteSession(
                    endpoint.workspaceId,
                    sessionId,
                    {
                      directory: assistantSessionWorkspace?.directory,
                    },
                  );
                  removeAssistantSession(sessionId);
                  removeExpertSession(sessionId);
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
                  await refreshRouteState();
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
