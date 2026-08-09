/**
 * Settings tab chunk prefetch — warm lazy page modules before the user clicks.
 *
 * - Enter settings: warm the most-used tabs (general / system / shortcuts / …).
 * - Sidebar hover: warm the hovered tab so first open skips the Suspense flash.
 *
 * Loaders are the same `import()` factories used by React.lazy; the module
 * graph dedupes concurrent imports for a path.
 */

import type { SettingsTab } from "../../../app/types";
import {
  loadAiSettingsView,
  loadArchivedTasksView,
  loadAuthorizedFoldersPanel,
  loadCloudMarketplacesView,
  loadCloudProvidersView,
  loadCompanySettingsView,
  loadConversationMemoryView,
  loadDebugView,
  loadEnvironmentView,
  loadGeneralSettingsView,
  loadMemoryView,
  loadPreferencesView,
  loadRecoveryView,
  loadShortcutsView,
  loadSystemAuthorizationsView,
  loadSystemSettingsView,
  loadUpdatesView,
  loadUsageView,
} from "./lazy-pages";

/** Tabs users hit most often after opening Settings. */
export const COMMON_SETTINGS_PREFETCH_TABS: readonly SettingsTab[] = [
  "general",
  "system",
  "shortcuts",
  "preferences",
  "ai",
] as const;

/**
 * Map a settings tab to the dynamic import(s) that tab body needs.
 * Multi-chunk tabs (e.g. system) warm every stacked panel.
 */
function loadersForSettingsTab(tab: SettingsTab): Array<() => Promise<unknown>> {
  switch (tab) {
    case "general":
      return [loadGeneralSettingsView];
    case "company":
      return [loadCompanySettingsView];
    case "preferences":
      return [loadPreferencesView];
    case "memory":
      return [loadMemoryView];
    case "conversation-memory":
      return [loadConversationMemoryView];
    case "permissions":
    case "environment":
    case "system":
      // System stack: settings + authorizations + folders + env (see settings-tab-body).
      return [
        loadSystemSettingsView,
        loadSystemAuthorizationsView,
        loadAuthorizedFoldersPanel,
        loadEnvironmentView,
      ];
    case "shortcuts":
      return [loadShortcutsView];
    case "ai":
      return [loadAiSettingsView, loadCloudProvidersView];
    case "cloud-providers":
      return [loadCloudProvidersView];
    case "cloud-marketplaces":
      return [loadCloudMarketplacesView];
    case "updates":
      return [loadUpdatesView];
    case "usage":
      return [loadUsageView];
    case "archived-tasks":
      return [loadArchivedTasksView];
    case "recovery":
      return [loadRecoveryView];
    case "debug":
      return [loadDebugView];
    case "app-snapshot":
      // Hosted elsewhere / no lazy settings page loader.
      return [];
    default: {
      const _exhaustive: never = tab;
      void _exhaustive;
      return [];
    }
  }
}

const started = new Set<string>();

function loaderKey(tab: SettingsTab, index: number): string {
  return `${tab}:${index}`;
}

/**
 * Fire-and-forget prefetch for one settings tab.
 * Safe to call repeatedly (hover spam, route remounts).
 */
export function prefetchSettingsTab(tab: SettingsTab): void {
  const loaders = loadersForSettingsTab(tab);
  for (let i = 0; i < loaders.length; i += 1) {
    const key = loaderKey(tab, i);
    if (started.has(key)) continue;
    started.add(key);
    const load = loaders[i]!;
    void load().catch(() => {
      // Allow a later hover/open to retry after a failed network fetch.
      started.delete(key);
    });
  }
}

/** Prefetch the high-traffic tabs when the user enters Settings. */
export function prefetchCommonSettingsTabs(): void {
  for (const tab of COMMON_SETTINGS_PREFETCH_TABS) {
    prefetchSettingsTab(tab);
  }
}

/**
 * Schedule common-tab prefetch on idle so it does not compete with first paint.
 * Falls back to a short timeout when requestIdleCallback is unavailable.
 */
export function schedulePrefetchCommonSettingsTabs(): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    prefetchCommonSettingsTabs();
  };

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(run, { timeout: 1500 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(id);
    };
  }

  const timer = globalThis.setTimeout(run, 120);
  return () => {
    cancelled = true;
    globalThis.clearTimeout(timer);
  };
}
