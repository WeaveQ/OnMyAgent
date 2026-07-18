/** @jsxImportSource react */
/**
 * Settings tab bodies loaded on demand via domain barrel loaders.
 * Opening Settings evaluates host chrome only; each tab module loads when selected.
 */
import { lazy, Suspense, type ReactNode } from "react";

import { OwDotTicker } from "../dot-ticker";
import { t } from "../../../i18n";
import {
  loadAiSettingsView,
  loadArchivedTasksView,
  loadAuthorizedFoldersPanel,
  loadCloudMarketplacesView,
  loadCloudProvidersView,
  loadConversationMemoryView,
  loadDebugView,
  loadEnvironmentView,
  loadExtensionsView,
  loadGeneralSettingsView,
  loadMcpView,
  loadMemoryView,
  loadPreferencesView,
  loadSystemAuthorizationsView,
  loadUpdatesView,
} from "../../domains/settings";

const tabFallbackClass = {
  shell: "flex min-h-[12rem] w-full items-center justify-center py-10",
  message: "mt-3 text-xs leading-5 text-dls-secondary",
};

export function SettingsTabSuspense(props: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          className={tabFallbackClass.shell}
          aria-live="polite"
          aria-busy="true"
          role="status"
        >
          <div className="flex flex-col items-center">
            <OwDotTicker size="sm" />
            <div className={tabFallbackClass.message}>
              {t("system.boot_preparing_workspace")}
            </div>
          </div>
        </div>
      }
    >
      {props.children}
    </Suspense>
  );
}

export const LazyGeneralSettingsView = lazy(() =>
  loadGeneralSettingsView().then((module) => ({
    default: module.GeneralSettingsView,
  })),
);

export const LazyPreferencesView = lazy(() =>
  loadPreferencesView().then((module) => ({
    default: module.PreferencesView,
  })),
);

export const LazyMemoryView = lazy(() =>
  loadMemoryView().then((module) => ({ default: module.MemoryView })),
);

export const LazyConversationMemoryView = lazy(() =>
  loadConversationMemoryView().then((module) => ({
    default: module.ConversationMemoryView,
  })),
);

export const LazySystemAuthorizationsView = lazy(() =>
  loadSystemAuthorizationsView().then((module) => ({
    default: module.SystemAuthorizationsView,
  })),
);

export const LazyAuthorizedFoldersPanel = lazy(() =>
  loadAuthorizedFoldersPanel().then((module) => ({
    default: module.AuthorizedFoldersPanel,
  })),
);

export const LazyAiSettingsView = lazy(() =>
  loadAiSettingsView().then((module) => ({
    default: module.AiSettingsView,
  })),
);

export const LazyEnvironmentView = lazy(() =>
  loadEnvironmentView().then((module) => ({
    default: module.EnvironmentView,
  })),
);

export const LazyUpdatesView = lazy(() =>
  loadUpdatesView().then((module) => ({ default: module.UpdatesView })),
);

export const LazyDebugView = lazy(() =>
  loadDebugView().then((module) => ({ default: module.DebugView })),
);

export const LazyArchivedTasksView = lazy(() =>
  loadArchivedTasksView().then((module) => ({
    default: module.ArchivedTasksView,
  })),
);

export const LazyCloudProvidersView = lazy(() =>
  loadCloudProvidersView().then((module) => ({
    default: module.CloudProvidersView,
  })),
);

export const LazyCloudMarketplacesView = lazy(() =>
  loadCloudMarketplacesView().then((module) => ({
    default: module.CloudMarketplacesView,
  })),
);

export const LazyExtensionsView = lazy(() =>
  loadExtensionsView().then((module) => ({
    default: module.ExtensionsView,
  })),
);

export const LazyMcpView = lazy(() =>
  loadMcpView().then((module) => ({ default: module.McpView })),
);
