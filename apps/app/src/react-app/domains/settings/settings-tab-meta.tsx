/**
 * Settings tab metadata — icons, labels, descriptions, and nav grouping.
 *
 * This module is intentionally UI-chrome free and imports neither the shell
 * (`shell/settings-page`) nor the lazy page factories (`lazy-pages`), so page
 * bodies (e.g. general-view) can read tab metadata without pulling in the
 * shell and the prefetch/lazy graph.
 */

import {
  Archive,
  Brain,
  Bug,
  Building2,
  Camera,
  ChartNoAxesCombined,
  CloudCog,
  Cog,
  Cpu,
  FolderLock,
  Keyboard,
  Monitor,
  RefreshCcw,
  RotateCcw,
  SlidersHorizontal,
  Store,
  Terminal,
  UserCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { t } from "../../../i18n";
import type { SettingsTab } from "../../../app/types";

export function getSettingsTabIcon(tab: SettingsTab): LucideIcon {
  switch (tab) {
    case "ai":
      // Models / providers — compute, not a generic lightning bolt.
      return Cpu;
    case "preferences":
      return SlidersHorizontal;
    case "permissions":
      return FolderLock;
    case "system":
      // OS/app system prefs — not the LocalAgent monitor-phone glyph.
      return Monitor;
    case "company":
      return Building2;
    case "shortcuts":
      return Keyboard;
    case "app-snapshot":
      return Camera;
    case "cloud-marketplaces":
      return Store;
    case "cloud-providers":
      return CloudCog;
    case "environment":
      return Terminal;
    case "updates":
      return RefreshCcw;
    case "usage":
      return ChartNoAxesCombined;
    case "memory":
      return UserCircle;
    case "conversation-memory":
      return Brain;
    case "archived-tasks":
      return Archive;
    case "recovery":
      return RotateCcw;
    case "debug":
      return Bug;
    default:
      return Cog;
  }
}

export function getSettingsTabLabel(tab: SettingsTab): string {
  switch (tab) {
    case "ai":
      return t("settings.ai_providers");
    case "preferences":
      return t("settings.preferences");
    case "permissions":
      return t("settings.permissions");
    case "system":
      return t("settings.tab_system");
    case "company":
      return t("settings.tab_company");
    case "shortcuts":
      return t("settings.tab_shortcuts");
    case "app-snapshot":
      return t("settings.tab_app_snapshot");
    case "cloud-marketplaces":
      return t("settings.tab_cloud_marketplaces");
    case "cloud-providers":
      return t("settings.tab_cloud_providers");
    case "environment":
      return t("settings.tab_environment");
    case "updates":
      return t("settings.tab_updates");
    case "usage":
      return t("settings.tab_usage");
    case "memory":
      return t("settings.tab_memory");
    case "conversation-memory":
      return t("settings.tab_conversation_memory");
    case "archived-tasks":
      return t("settings.tab_archived_tasks");
    case "recovery":
      return t("settings.tab_recovery");
    case "debug":
      return t("settings.tab_debug");
    case "general":
      return t("settings.tab_general");
    default:
      return t("settings.tab_general");
  }
}

export function getSettingsTabDescription(tab: SettingsTab): string {
  switch (tab) {
    case "ai":
      return t("settings.ai_providers_card_description");
    case "preferences":
      return t("settings.preferences_card_description");
    case "permissions":
      return t("settings.permissions_card_description");
    case "system":
      return t("settings.tab_description_system");
    case "company":
      return t("settings.tab_description_company");
    case "shortcuts":
      return t("settings.tab_description_shortcuts");
    case "app-snapshot":
      return t("settings.tab_description_app_snapshot");
    case "cloud-marketplaces":
      return t("settings.tab_description_cloud_marketplaces");
    case "cloud-providers":
      return t("settings.tab_description_cloud_providers");
    case "environment":
      return t("settings.tab_description_environment");
    case "updates":
      return t("settings.tab_description_updates");
    case "usage":
      return t("settings.tab_description_usage");
    case "memory":
      return t("settings.tab_description_memory");
    case "conversation-memory":
      return t("settings.tab_description_conversation_memory");
    case "archived-tasks":
      return t("settings.tab_description_archived_tasks");
    case "recovery":
      return t("settings.tab_description_recovery");
    case "debug":
      return t("settings.tab_description_debug");
    case "general":
      return t("settings.tab_description_setting_general");
    default:
      return t("settings.tab_description_general");
  }
}

/**
 * Settings nav IA (top → bottom):
 * 1. Overview (ungrouped)
 * 2. Workspace — workspace-scoped: models, company
 * 3. Personal — profile + memory
 * 4. App / Global — appearance, OS, shortcuts, env, updates
 * 5. Data — reset, archive (usage nav hidden for now; route still works)
 *
 * Preferences (language/theme/font) stay under Global, not Workspace.
 */
export function getOverviewSettingsTabs(): SettingsTab[] {
  return ["general"];
}

/** Models + company connect (workspace / org scoped). */
export function getWorkspaceSettingsTabs(): SettingsTab[] {
  return ["ai", "company"];
}

/** Personal profile + conversation/work memory. */
export function getPersonalMemorySettingsTabs(): SettingsTab[] {
  return ["memory", "conversation-memory"];
}

/**
 * Reset/recovery + archive.
 * Usage is intentionally omitted from nav (and overview); keep the tab type
 * + lazy view for deep links until the page ships publicly.
 */
export function getDataSettingsTabs(): SettingsTab[] {
  return ["recovery", "archived-tasks"];
}

/** @deprecated Use getDataSettingsTabs */
export function getArchivedSettingsTabs(): SettingsTab[] {
  return getDataSettingsTabs();
}

/**
 * App-wide settings. Environment is fused into System (not a top-level nav
 * item); deep links /settings/environment still resolve to system.
 */
export function getGlobalSettingsTabs(developerMode: boolean): SettingsTab[] {
  const tabs: SettingsTab[] = [
    "preferences",
    "system",
    "shortcuts",
    "updates",
  ];
  if (developerMode) tabs.push("debug");
  return tabs;
}

/**
 * Single source of truth for Settings sidebar + compact section menu groups.
 * Labels are i18n keys (or null for overview-only top block).
 */
export type SettingsNavSectionDef = {
  labelKey: string | null;
  tabs: SettingsTab[];
};

export function getSettingsNavSections(
  developerMode: boolean,
): SettingsNavSectionDef[] {
  return [
    { labelKey: null, tabs: getOverviewSettingsTabs() },
    { labelKey: "settings.group_workspace", tabs: getWorkspaceSettingsTabs() },
    {
      labelKey: "settings.group_personal_memory",
      tabs: getPersonalMemorySettingsTabs(),
    },
    {
      labelKey: "settings.group_global",
      tabs: getGlobalSettingsTabs(developerMode),
    },
    { labelKey: "settings.group_data", tabs: getDataSettingsTabs() },
  ];
}
