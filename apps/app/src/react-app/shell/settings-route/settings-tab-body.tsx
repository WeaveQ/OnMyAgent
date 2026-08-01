// @ts-nocheck — settings host bag; property types owned by render.tsx
/** @jsxImportSource react */
/**
 * Settings tab body switch — extracted from settings-route/render.tsx.
 * Host owns state; this file only builds the lazy tab tree from a context bag.
 */
import type { ReactNode } from "react";
import type { SettingsTabBodyCtx } from "./settings-tab-body-ctx";
import { SettingsStack } from "../../domains/settings";
import {
  canDeleteOpenCodeProvider,
  canDisconnectProviderRow,
  canEditOpenCodeProvider,
} from "./provider-disconnect-policy";
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
import { readLocalAuthUser } from "../../../app/lib/local-auth";
import { t } from "../../../i18n";
import { userErrorFromRaw } from "../../kernel/user-error";
import { isDesktopRuntime } from "../../../app/utils";

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
    case "permissions":
      // Fused into System settings — deep links should redirect via parseSettingsPath.
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
              dockUnreadBadge={ctx.local.prefs.dockUnreadBadge !== false}
              soundNotifyOnAgentReady={
                ctx.local.prefs.soundNotifyOnAgentReady !== false
              }
              desktopNotifyOnAgentReady={
                ctx.local.prefs.desktopNotifyOnAgentReady === true
              }
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
              }}
              onDockUnreadBadgeChange={(enabled) => {
                ctx.local.setPrefs((previous) => ({
                  ...previous,
                  dockUnreadBadge: enabled,
                }));
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
            canDisconnectProvider={(provider) =>
              canDisconnectProviderRow({
                provider,
                opencodeInventoryReady: ctx.opencodeInventoryReady,
              })
            }
            canEditProvider={canEditOpenCodeProvider}
            onEditProvider={ctx.handleEditOpenCodeProvider}
            canDeleteProvider={canDeleteOpenCodeProvider}
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
              ctx.local.setPrefs((previous) => ({
                ...previous,
                responseTone,
              }));
            }}
            customInstructions={ctx.local.prefs.customInstructions}
            onCustomInstructionsChange={(customInstructions) => {
              ctx.local.setPrefs((previous) => ({
                ...previous,
                customInstructions,
              }));
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
          />
        </SettingsTabSuspense>
      );
    case "environment":
      return (
        <SettingsTabSuspense>
          <LazyEnvironmentView
            client={ctx.onmyagentServerSnapshot.onmyagentServerClient}
            isRemoteWorkspace={ctx.isRemoteWorkspace}
            onApplyChanges={isDesktopRuntime() && !ctx.isRemoteWorkspace ? ctx.handleApplyEnvironmentChanges : undefined}
            applyBlocked={ctx.activeReloadBlockingSessions.length > 0}
            applyBlockedReason={
              ctx.activeReloadBlockingSessions.length > 0
                ? t("settings.environment.apply_blocked_active_tasks")
                : null
            }
            runtimeKey={ctx.environmentRuntimeKey}
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
