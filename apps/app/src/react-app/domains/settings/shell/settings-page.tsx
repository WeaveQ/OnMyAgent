/** @jsxImportSource react */
import type * as React from "react";
import {
  Archive,
  ArrowLeft,
  Bug,
  Brain,
  Camera,
  ChartNoAxesCombined,
  Building2,
  CloudCog,
  Cog,
  FolderLock,
  Keyboard,
  MonitorSmartphone,
  RefreshCcw,
  RotateCcw,
  SlidersHorizontal,
  Store,
  Terminal,
  UserCircle,
  Zap,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import {
  SettingsPanel,
  SettingsPanelContent,
  SettingsPanelToolbar,
  SettingsPanelToolbarActions,
  SettingsPanelToolbarButton,
  SettingsPanelToolbarMessage,
  SettingsPanelToolbarStatus,
} from "./panel";

const settingsSidebarGroupLabelClass =
  "px-2 text-xs font-medium tracking-wide text-dls-secondary";

/** Settings list-lane chrome: solid cool sidebar (not rail/vibrancy bleed). */
const settingsSidebarClass =
  "**:data-[sidebar=sidebar]:bg-dls-sidebar **:data-[sidebar=sidebar]:text-dls-text";

/** Nav rows use primary text color for both idle and active (highlight = bg only). */
const settingsNavButtonClass =
  "text-dls-text hover:bg-dls-list-hover hover:text-dls-text data-active:bg-dls-list-selected data-active:font-medium data-active:text-dls-text mac:hover:bg-dls-list-hover mac:active:bg-dls-list-hover mac:data-active:bg-dls-list-selected dark:mac:hover:bg-dls-list-hover dark:mac:active:bg-dls-list-hover dark:mac:data-active:bg-dls-list-selected";

export function getSettingsTabIcon(tab: SettingsTab) {
  switch (tab) {
    case "ai":
      return Zap;
    case "preferences":
      return SlidersHorizontal;
    case "permissions":
      return FolderLock;
    case "system":
      return MonitorSmartphone;
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

export function getSettingsTabLabel(tab: SettingsTab) {
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

export function getSettingsTabDescription(tab: SettingsTab) {
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
 * App-wide settings: appearance first, then system/runtime.
 * Preferences are not workspace-scoped (language/theme/font).
 */
/**
 * App-wide settings. Environment is fused into System (not a top-level nav item);
 * deep links /settings/environment still resolve to system.
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

type SettingsPageProps = {
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  showUpdateToolbar?: boolean;
  updateToolbarTone?: string;
  updateToolbarTitle?: string;
  updateToolbarSpinning?: boolean;
  updateToolbarLabel?: string;
  updateToolbarActionLabel?: string | null;
  updateToolbarDisabled?: boolean;
  updateRestartBlockedMessage?: string | null;
  onUpdateToolbarAction?: () => void;
  panelToolbarSlot?: React.ReactNode;
  children: React.ReactNode;
};

type SettingsSidebarProps = Pick<
  SettingsPageProps,
  "activeTab" | "onSelectTab" | "developerMode"
> & {
  onClose: () => void;
};

function SettingsNavGroup(props: {
  /** When null/empty, render tabs without a section label (standalone row). */
  label?: string | null;
  tabs: SettingsTab[];
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
}) {
  if (props.tabs.length === 0) return null;
  const label = props.label?.trim() || null;
  return (
    <SidebarGroup className={label ? "px-0 py-2" : "px-0 py-1"}>
      {label ? (
        <SidebarGroupLabel className={settingsSidebarGroupLabelClass}>
          {label}
        </SidebarGroupLabel>
      ) : null}
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {props.tabs.map((tab) => {
            const Icon = getSettingsTabIcon(tab);
            return (
              <SidebarMenuItem key={tab}>
                <SidebarMenuButton
                  type="button"
                  isActive={props.activeTab === tab}
                  onClick={() => props.onSelectTab(tab)}
                  size="settings"
                  className={settingsNavButtonClass}
                >
                  <Icon />
                  <span>{getSettingsTabLabel(tab)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function SettingsSidebar(props: SettingsSidebarProps) {
  const sections = getSettingsNavSections(props.developerMode);

  return (
    <Sidebar className={settingsSidebarClass}>
      <div className="hidden h-10 mac:block mac:titlebar-drag" />
      <SidebarHeader className="px-2 pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={props.onClose}
              size="settings"
              className={settingsNavButtonClass}
            >
              <ArrowLeft size={14} />
              <span>{t("dashboard.back_to_app")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="px-2 pb-4">
        {sections.map((section) => (
          <SettingsNavGroup
            key={section.labelKey ?? "overview"}
            label={section.labelKey ? t(section.labelKey as never) : undefined}
            tabs={section.tabs}
            activeTab={props.activeTab}
            onSelectTab={props.onSelectTab}
          />
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

export function SettingsPage(props: SettingsPageProps) {
  const hasPanelHeader =
    props.panelToolbarSlot ||
    (props.showUpdateToolbar && props.activeTab === "general");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hasPanelHeader ? (
        <SettingsPanel>
          {props.showUpdateToolbar && props.activeTab === "general" ? (
            <SettingsPanelToolbar>
              <SettingsPanelToolbarActions>
                <SettingsPanelToolbarStatus
                  tone={props.updateToolbarTone}
                  title={props.updateToolbarTitle}
                  spinning={props.updateToolbarSpinning}
                >
                  {props.updateToolbarLabel}
                </SettingsPanelToolbarStatus>
                {props.updateToolbarActionLabel ? (
                  <SettingsPanelToolbarButton
                    onClick={props.onUpdateToolbarAction}
                    disabled={props.updateToolbarDisabled}
                    title={props.updateRestartBlockedMessage ?? ""}
                  >
                    {props.updateToolbarActionLabel}
                  </SettingsPanelToolbarButton>
                ) : null}
              </SettingsPanelToolbarActions>
              {props.updateRestartBlockedMessage ? (
                <SettingsPanelToolbarMessage>
                  {props.updateRestartBlockedMessage}
                </SettingsPanelToolbarMessage>
              ) : null}
            </SettingsPanelToolbar>
          ) : null}
          {props.panelToolbarSlot}
        </SettingsPanel>
      ) : null}

      <SettingsPanelContent>
        {props.children}
      </SettingsPanelContent>
    </div>
  );
}
