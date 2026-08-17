// @ts-nocheck — settings host bag; property types owned by render.tsx
/** @jsxImportSource react */
/**
 * Settings tab body switch — extracted from settings-route/render.tsx.
 * Host owns state; this file only builds the lazy tab tree from a context bag.
 */
import type { ReactNode } from "react";
import type { SettingsTabBodyCtx } from "./settings-tab-body-ctx";
import { SettingsStack } from "../../domains/settings";
import { deleteSessionOwnedWorkspaceFiles } from "../../domains/workspace";
import { canEditOpenCodeProvider } from "./provider-disconnect-policy";
import { resolveProviderRemoveChromeMode } from "./provider-remove-chrome";
import {
  deleteOpenCodeManagedProvider,
  disconnectSettingsProvider,
} from "./provider-list-actions";
import {
  LazyAiSettingsView,
  LazyArchivedTasksView,
  LazyAuthorizedFoldersPanel,
  LazyCloudMarketplacesView,
  LazyCloudProvidersView,
  LazyConversationMemoryView,
  LazyDebugView,
  LazyRecoveryView,
  LazyEnvironmentView,
  LazyCompanySettingsView,
  LazyGeneralSettingsView,
  LazyMemoryView,
  LazyPreferencesView,
  LazySystemAuthorizationsView,
  LazySystemSettingsView,
  LazyShortcutsView,
  LazyUpdatesView,
  LazyUsageView,
  SettingsAiTabSuspense,
  SettingsTabSuspense,
} from "./lazy-tab-views";
import { desktopBridge } from "../../../app/lib/desktop";
import { readLocalAuthUser } from "../../../app/lib/local-auth";
import { t } from "../../../i18n";
import { userErrorFromRaw } from "../../kernel/user-error";
import { isDesktopRuntime } from "../../../app/utils";

/** First enable of desktop alerts: prompt while we still have a user gesture. */
function requestDesktopNotificationPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => undefined);
}

/** Fire a forced sample toast so Windows users can verify the OS path works. */
function previewDesktopNotification(): void {
  if (!isDesktopRuntime()) return;
  void desktopBridge
    .showDesktopNotification({
      title: t("settings.agent_ready_notification_title"),
      body: t("settings.agent_ready_notifications_label"),
      force: true,
    })
    .catch(() => undefined);
}

export function SettingsTabBody(ctx: SettingsTabBodyCtx): ReactNode {
  switch (ctx.tab) {
    case "general":
      return (
        <SettingsTabSuspense>
          <LazyGeneralSettingsView
            onNavigateTab={(tab) => ctx.navigateSettingsPath(tab)}
            developerMode={ctx.developerMode}
            onReportIssue={() => ctx.platform.openLink("https://github.com/WeaveQ/onmyagent/issues/new?template=bug.yml")}
          />
        </SettingsTabSuspense>
      );
    case "company":
      return (
        <SettingsTabSuspense>
          <LazyCompanySettingsView busy={ctx.busy} />
        </SettingsTabSuspense>
      );
    case "permissions":
    case "environment":
      // Fused into System settings — deep links redirect via parseSettingsPath.
      // Fall through to same body if redirect missed.
    case "system":
      return (
        <SettingsTabSuspense>
          <SettingsStack>
            <LazySystemSettingsView
              busy={ctx.busy}
              launchAtLogin={ctx.local.prefs.launchAtLogin !== false}
              keepSystemAwake={ctx.local.prefs.keepSystemAwake === true}
              desktopNotificationsEnabled={
                ctx.local.prefs.desktopNotificationsEnabled !== false
              }
              soundNotifyOnAgentReady={
                ctx.local.prefs.soundNotifyOnAgentReady !== false
              }
              desktopNotifyOnAgentReady={
                ctx.local.prefs.desktopNotifyOnAgentReady === true
              }
              updateAutoCheck={ctx.updateAutoCheck !== false}
              onLaunchAtLoginChange={(enabled) => {
                ctx.local.setPrefs((previous) => ({
                  ...previous,
                  launchAtLogin: enabled,
                }));
              }}
              onKeepSystemAwakeChange={(enabled) => {
                ctx.local.setPrefs((previous) => ({
                  ...previous,
                  keepSystemAwake: enabled,
                }));
              }}
              onDesktopNotificationsEnabledChange={(enabled) => {
                ctx.local.setPrefs((previous) => ({
                  ...previous,
                  desktopNotificationsEnabled: enabled,
                }));
                if (enabled) {
                  requestDesktopNotificationPermission();
                }
              }}
              onSoundNotifyOnAgentReadyChange={(enabled) => {
                ctx.local.setPrefs((previous) => ({
                  ...previous,
                  soundNotifyOnAgentReady: enabled,
                }));
              }}
              onDesktopNotifyOnAgentReadyChange={(enabled) => {
                ctx.local.setPrefs((previous) => ({
                  ...previous,
                  desktopNotifyOnAgentReady: enabled,
                }));
                if (enabled) {
                  requestDesktopNotificationPermission();
                  previewDesktopNotification();
                }
              }}
              onUpdateAutoCheckChange={(enabled) => {
                ctx.setUpdateAutoCheck(enabled);
              }}
            />
            <LazySystemAuthorizationsView
              busy={ctx.busy}
              showAgentReadyNotifications={false}
              desktopNotifyOnAgentReady={
                ctx.local.prefs.desktopNotifyOnAgentReady === true
              }
              onDesktopNotifyOnAgentReadyChange={(enabled) => {
                ctx.local.setPrefs((previous) => ({
                  ...previous,
                  desktopNotifyOnAgentReady: enabled,
                }));
                if (enabled) {
                  requestDesktopNotificationPermission();
                  previewDesktopNotification();
                }
              }}
            />
            <LazyAuthorizedFoldersPanel
              onmyagentServerClient={ctx.onmyagentClient}
              onmyagentServerStatus={ctx.routeOnMyAgentStatus}
              onmyagentServerCapabilities={ctx.routeOnMyAgentCapabilities}
              runtimeWorkspaceId={ctx.runtimeWorkspaceId}
              selectedWorkspaceRoot={ctx.selectedWorkspaceRoot}
              activeWorkspaceType={ctx.workspaceType}
              onConfigUpdated={() => {
                ctx.setConfigActionStatus(t("settings.config_updated"));
                void ctx.providerAuthStore.refreshProviders();
                void ctx.connectionsStore.refreshMcpServers();
              }}
            />
            <LazyEnvironmentView
              client={ctx.onmyagentServerSnapshot.onmyagentServerClient}
              isRemoteWorkspace={ctx.isRemoteWorkspace}
              onApplyChanges={
                isDesktopRuntime() && !ctx.isRemoteWorkspace
                  ? ctx.handleApplyEnvironmentChanges
                  : undefined
              }
              applyBlocked={ctx.activeReloadBlockingSessions.length > 0}
              applyBlockedReason={
                ctx.activeReloadBlockingSessions.length > 0
                  ? t("settings.environment.apply_blocked_active_tasks")
                  : null
              }
              runtimeKey={ctx.environmentRuntimeKey}
            />
          </SettingsStack>
        </SettingsTabSuspense>
      );
    case "ai":
      return (
        <SettingsAiTabSuspense>
          <LazyAiSettingsView
            busy={ctx.busy}
            providerAuthBusy={ctx.providerAuthSnapshot.providerAuthBusy}
            providerStatusLabel={ctx.providerStatusLabel}
            providerStatusStyle={ctx.providerStatusStyle}
            providerSummary={ctx.providerSummary}
            providerConnected={ctx.connectedProviders.length > 0}
            connectedProviders={ctx.connectedProviders}
            onReorderProviders={
              typeof ctx.reorderConnectedProviders === "function"
                ? (ctx.reorderConnectedProviders as (
                    fromId: string,
                    toId: string,
                  ) => void)
                : undefined
            }
            onMoveProvider={
              typeof ctx.moveConnectedProvider === "function"
                ? ctx.moveConnectedProvider
                : undefined
            }
            disconnectingProviderId={ctx.providerActionBusyId}
            providerConnectError={
              ctx.providerAuthSnapshot.providerAuthError
                ? userErrorFromRaw(ctx.providerAuthSnapshot.providerAuthError)
                : null
            }
            providerDisconnectStatus={null}
            providerDisconnectError={ctx.providerActionError}
            providerActionBusyId={ctx.providerActionBusyId}
            providerSyncBusy={ctx.providerSyncBusy}
            runtimeConnected={Boolean(ctx.activeClient)}
            providersLoading={ctx.providersDiscovering}
            inventorySyncing={ctx.inventorySyncing}
            onOpenProviderAuth={ctx.handleOpenProviderAuth}
            onOpenOpencodeConfig={ctx.handleOpenCustomProviderConfig}
            onDisconnectProvider={(providerId) =>
              disconnectSettingsProvider({
                providerId,
                disconnectProvider: (id) =>
                  ctx.providerAuthStore.disconnectProvider(id),
                setBusyId: ctx.setProviderActionBusyId,
                setError: ctx.setProviderActionError,
              })
            }
            resolveRemoveMode={(provider) =>
              resolveProviderRemoveChromeMode({
                provider,
                opencodeInventoryReady: ctx.opencodeInventoryReady,
              })
            }
            canEditProvider={canEditOpenCodeProvider}
            onEditProvider={ctx.handleEditOpenCodeProvider}
            onDeleteProvider={async (provider) => {
              if (ctx.providerActionBusyId || ctx.providerSyncBusy) return;
              await deleteOpenCodeManagedProvider({
                providerId: provider.id,
                workspaceRoot: ctx.selectedWorkspaceRoot,
                defaultModelProviderId:
                  ctx.local.prefs.defaultModel?.providerID ?? null,
                setBusyId: ctx.setProviderActionBusyId,
                setSyncBusy: ctx.setProviderSyncBusy,
                setError: ctx.setProviderActionError,
                setOpenCodeManagedProviders: ctx.setOpenCodeManagedProviders,
                setPrefs: ctx.local.setPrefs,
                applyEngineConfigForProviders: ctx.applyEngineConfigForProviders,
                refreshProviders: (opts) =>
                  ctx.providerAuthStore.refreshProviders(opts),
                loadOpenCodeManagedProviders: ctx.loadOpenCodeManagedProviders,
                clearReloadRequired: () =>
                  ctx.reloadCoordinator.clearReloadRequired(),
                markReloadRequired: (kind, detail) =>
                  ctx.reloadCoordinator.markReloadRequired(kind, detail),
                // Connector installs (Ollama) live in workspace opencode.jsonc.
                removeWorkspaceProvider: async (providerId) => {
                  const client = ctx.activeClient as
                    | {
                        patchConfig?: (
                          workspaceId: string,
                          payload: {
                            opencode?: Record<string, unknown>;
                          },
                        ) => Promise<unknown>;
                      }
                    | null
                    | undefined;
                  const workspaceId = String(
                    ctx.selectedWorkspaceId ?? ctx.runtimeWorkspaceId ?? "",
                  ).trim();
                  if (!client?.patchConfig || !workspaceId) return;
                  // null survives JSON; server maps null → remove provider key
                  await client.patchConfig(workspaceId, {
                    opencode: {
                      provider: {
                        [providerId]: null,
                      },
                    },
                  });
                },
              });
            }}
            cloudProviderIds={new Set(
              Object.values(ctx.providerAuthSnapshot.importedCloudProviders ?? {}).map(
                (p) =>
                  p && typeof p === "object" && "providerId" in p
                    ? String((p as { providerId?: unknown }).providerId ?? "")
                    : "",
              ),
            )}
            showOnMyAgentModelsSubscribe={ctx.showOnMyAgentModelsSubscribe}
            onSubscribeOnMyAgentModels={ctx.subscribeToOnMyAgentModels}
            cloudProvidersView={
              <LazyCloudProvidersView
                embedded
                cloudOrgProviders={ctx.providerAuthSnapshot.cloudOrgProviders}
                connectCloudProvider={ctx.providerAuthStore.connectCloudProvider}
                importedCloudProviders={ctx.providerAuthSnapshot.importedCloudProviders}
                refreshCloudOrgProviders={ctx.providerAuthStore.refreshCloudOrgProviders}
                removeCloudProvider={ctx.providerAuthStore.removeCloudProvider}
                session={ctx.denSession}
              />
            }
          />
        </SettingsAiTabSuspense>
      );
    case "memory":
      return (
        <SettingsTabSuspense>
          <LazyMemoryView
            draft={ctx.memoryDraft ?? {
              userName: "",
              assistantName: "",
              mbti: "",
              roles: [],
              industries: [],
              tools: [],
              tasks: [],
              docPreference: "",
              terminology: "",
              skipped: false,
              updatedAt: 0,
            }}
            onDraftChange={ctx.persistMemoryDraft}
            busy={ctx.busy}
            responseTone={ctx.local.prefs.responseTone}
            onResponseToneChange={(responseTone) => {
              if (typeof ctx.persistResponseTone === "function") {
                ctx.persistResponseTone(responseTone);
              } else {
                ctx.local.setPrefs((previous: { responseTone?: string }) => ({
                  ...previous,
                  responseTone,
                }));
              }
            }}
            customInstructions={ctx.local.prefs.customInstructions}
            onCustomInstructionsChange={(customInstructions) => {
              if (typeof ctx.persistCustomInstructions === "function") {
                ctx.persistCustomInstructions(customInstructions);
              } else {
                ctx.local.setPrefs(
                  (previous: { customInstructions?: string }) => ({
                    ...previous,
                    customInstructions,
                  }),
                );
              }
            }}
          />
        </SettingsTabSuspense>
      );
    case "conversation-memory":
      return (
        <SettingsTabSuspense>
          <LazyConversationMemoryView
            conversationMemory={ctx.conversationMemoryDraft}
            onConversationMemoryChange={ctx.persistConversationMemory}
            onboardingProfile={ctx.local.prefs.onboardingProfile}
            responseTone={ctx.local.prefs.responseTone}
            customInstructions={ctx.local.prefs.customInstructions}
            userProfileLabels={ctx.userProfileLabels}
            onApplyAwarenessFileToPrefs={(patch) => {
              // Viewer save → prefs; file already written by modal.
              if (
                patch.onboardingProfile &&
                typeof ctx.persistMemoryDraft === "function"
              ) {
                ctx.persistMemoryDraft(patch.onboardingProfile);
              }
              if (
                patch.responseTone !== undefined ||
                patch.customInstructions !== undefined
              ) {
                // Batch tone + instructions so neither field is applied with a stale sibling.
                const nextTone =
                  patch.responseTone ?? ctx.local.prefs.responseTone;
                const nextInstructions =
                  patch.customInstructions ??
                  ctx.local.prefs.customInstructions;
                ctx.local.setPrefs((previous: Record<string, unknown>) => ({
                  ...previous,
                  responseTone: nextTone,
                  customInstructions: nextInstructions,
                }));
              }
              if (
                patch.conversationMemory &&
                typeof ctx.persistConversationMemory === "function"
              ) {
                ctx.persistConversationMemory(patch.conversationMemory);
              }
            }}
            onResetCollaborationStyle={() => {
              if (typeof ctx.persistResponseTone === "function") {
                ctx.persistResponseTone("default");
              } else {
                ctx.local.setPrefs((previous: Record<string, unknown>) => ({
                  ...previous,
                  responseTone: "default",
                }));
              }
              if (typeof ctx.persistCustomInstructions === "function") {
                ctx.persistCustomInstructions("");
              } else {
                ctx.local.setPrefs((previous: Record<string, unknown>) => ({
                  ...previous,
                  customInstructions: "",
                }));
              }
            }}
          />
        </SettingsTabSuspense>
      );
    case "preferences":
      return (
        <SettingsTabSuspense>
          <LazyPreferencesView
            busy={ctx.busy}
            showThinking={ctx.local.prefs.showThinking}
            onToggleShowThinking={() => {
              ctx.local.setPrefs((previous) => ({
                ...previous,
                showThinking: !previous.showThinking,
              }));
            }}
            autoCompactContext={ctx.autoCompactContext}
            autoCompactContextBusy={ctx.autoCompactContextBusy}
            onToggleAutoCompactContext={ctx.toggleAutoCompactContext}
            autoNewSessionOnIdle={ctx.local.prefs.autoNewSessionOnIdle === true}
            autoNewSessionIdleHours={ctx.local.prefs.autoNewSessionIdleHours ?? 6}
            onAutoNewSessionOnIdleChange={(enabled) => {
              ctx.local.setPrefs((previous) => ({
                ...previous,
                autoNewSessionOnIdle: enabled,
              }));
            }}
            onAutoNewSessionIdleHoursChange={(hours) => {
              ctx.local.setPrefs((previous) => ({
                ...previous,
                autoNewSessionIdleHours: hours,
              }));
            }}
            conversationWidth={
              ctx.local.prefs.conversationWidth === "wide" ? "wide" : "fixed"
            }
            onConversationWidthChange={(mode) => {
              ctx.local.setPrefs((previous) => ({
                ...previous,
                conversationWidth: mode,
              }));
            }}
            menuBarStatusItem={ctx.local.prefs.menuBarStatusItem !== false}
            onMenuBarStatusItemChange={(enabled) => {
              ctx.local.setPrefs((previous) => ({
                ...previous,
                menuBarStatusItem: enabled,
              }));
            }}
          />
        </SettingsTabSuspense>
      );
    case "shortcuts":
      return (
        <SettingsTabSuspense>
          <LazyShortcutsView
            busy={ctx.busy}
            keymapOverrides={ctx.local.prefs.keymapOverrides ?? {}}
            onKeymapOverridesChange={(next) => {
              ctx.local.setPrefs((previous) => ({
                ...previous,
                keymapOverrides: next,
              }));
            }}
          />
        </SettingsTabSuspense>
      );
    case "cloud-marketplaces":
      return (
        <SettingsTabSuspense>
          <LazyCloudMarketplacesView
            extensions={ctx.extensionsStore}
            session={ctx.denSession}
          />
        </SettingsTabSuspense>
      );
    case "cloud-providers":
      return (
        <SettingsTabSuspense>
          <LazyCloudProvidersView
            cloudOrgProviders={ctx.providerAuthSnapshot.cloudOrgProviders}
            connectCloudProvider={ctx.providerAuthStore.connectCloudProvider}
            importedCloudProviders={ctx.providerAuthSnapshot.importedCloudProviders}
            refreshCloudOrgProviders={ctx.providerAuthStore.refreshCloudOrgProviders}
            removeCloudProvider={ctx.providerAuthStore.removeCloudProvider}
            session={ctx.denSession}
          />
        </SettingsTabSuspense>
      );
    case "updates":
      return (
        <SettingsTabSuspense>
          <LazyUpdatesView
            busy={ctx.busy}
            webDeployment={ctx.platform.platform === "web"}
            appVersion={ctx.electronUpdaterState.appVersion}
            updateEnv={ctx.electronUpdaterState.updateEnv}
            updateAutoCheck={ctx.updateAutoCheck}
            toggleUpdateAutoCheck={() => ctx.setUpdateAutoCheck((current) => !current)}
            updateAutoDownload={ctx.updateAutoDownload}
            toggleUpdateAutoDownload={() =>
              ctx.setUpdateAutoDownload((current) => !current)
            }
            updateStatus={ctx.electronUpdaterState.updateStatus}
            anyActiveRuns={ctx.activeReloadBlockingSessions.length > 0}
            checkForUpdates={ctx.electronUpdaterState.checkForUpdates}
            downloadUpdate={ctx.electronUpdaterState.downloadUpdate}
            installUpdateAndRestart={ctx.electronUpdaterState.installUpdateAndRestart}
            installing={ctx.electronUpdaterState.installing}
            releaseChannel={ctx.local.prefs.releaseChannel ?? "stable"}
            onReleaseChannelChange={ctx.electronUpdaterState.setReleaseChannel}
            alphaChannelSupported={ctx.electronUpdaterState.alphaSupported === true}
          />
        </SettingsTabSuspense>
      );
    case "usage": {
      const localAuthUser = readLocalAuthUser();
      const profileName =
        ctx.memoryDraft?.userName?.trim()
        || ctx.local.prefs.onboardingProfile?.userName?.trim()
        || "";
      return (
        <SettingsTabSuspense>
          <LazyUsageView
            client={ctx.onmyagentClient ?? ctx.onmyagentServerSnapshot.onmyagentServerClient}
            workspaces={ctx.workspaces}
            identity={{
              name:
                profileName
                || localAuthUser?.username
                || localAuthUser?.email
                || t("session.current_user"),
              email: localAuthUser?.email ?? null,
            }}
          />
        </SettingsTabSuspense>
      );
    }
    case "archived-tasks":
      return (
        <SettingsTabSuspense>
          <LazyArchivedTasksView
            client={ctx.onmyagentClient ?? ctx.onmyagentServerSnapshot.onmyagentServerClient}
            workspaceId={ctx.runtimeWorkspaceId?.trim() || ctx.selectedWorkspaceId}
            workspaceRoot={ctx.selectedWorkspaceRoot}
            deleteSessionOwnedWorkspaceFiles={deleteSessionOwnedWorkspaceFiles}
          />
        </SettingsTabSuspense>
      );
    case "recovery":
      return (
        <SettingsTabSuspense>
          <LazyRecoveryView {...ctx.recoveryViewProps} />
        </SettingsTabSuspense>
      );
    case "debug":
      return (
        <SettingsTabSuspense>
          <LazyDebugView {...ctx.debugViewProps} />
        </SettingsTabSuspense>
      );
    default:
      return null;
  }

}
