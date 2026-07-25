/** @jsxImportSource react */
/**
 * Settings tab bodies loaded on demand via domain barrel loaders.
 * Opening Settings evaluates host chrome only; each tab module loads when selected.
 */
import { lazy, Suspense, type ReactNode } from "react";

import { LoadSurface } from "../load-surface";
import {
  AiSettingsProvidersSkeleton,
  loadAiSettingsView,
  loadArchivedTasksView,
  loadAuthorizedFoldersPanel,
  loadCloudMarketplacesView,
  loadCloudProvidersView,
  loadConversationMemoryView,
  loadDebugView,
  loadRecoveryView,
  loadEnvironmentView,
  loadGeneralSettingsView,
  loadMemoryView,
  loadPreferencesView,
  loadSystemAuthorizationsView,
  loadUpdatesView,
  loadUsageView,
} from "../../domains/settings";

export function SettingsTabSuspense(props: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <LoadSurface
          variant="inset"
          messageKey="system.load_settings_tab"
        />
      }
    >
      {props.children}
    </Suspense>
  );
}

/** AI / models tab: list-shaped skeleton instead of a centered spinner. */
export function SettingsAiTabSuspense(props: { children: ReactNode }) {
  return (
    <Suspense fallback={<AiSettingsProvidersSkeleton />}>
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

// Prefetch on module evaluate so Settings → 模型 first open skips the chunk wait.
void loadAiSettingsView();

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

export const LazyUsageView = lazy(() =>
  loadUsageView().then((module) => ({ default: module.UsageSettingsView })),
);

export const LazyDebugView = lazy(() =>
  loadDebugView().then((module) => ({ default: module.DebugView })),
);

export const LazyRecoveryView = lazy(() =>
  loadRecoveryView().then((module) => ({ default: module.RecoveryView })),
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
