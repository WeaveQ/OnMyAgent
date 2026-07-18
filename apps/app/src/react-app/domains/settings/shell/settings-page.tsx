/** @jsxImportSource react */
import type * as React from "react";
import {
  Archive,
  ArrowLeft,
  Bug,
  Brain,
  CloudCog,
  Cog,
  FolderLock,
  Puzzle,
  RefreshCcw,
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

/** Active/hover rows match list-lane tokens used by the main shell. */
const settingsNavButtonClass =
  "text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text data-active:bg-dls-list-selected data-active:font-medium data-active:text-dls-text mac:hover:bg-dls-list-hover mac:active:bg-dls-list-hover mac:data-active:bg-dls-list-selected dark:mac:hover:bg-dls-list-hover dark:mac:active:bg-dls-list-hover dark:mac:data-active:bg-dls-list-selected";

export function getSettingsTabIcon(tab: SettingsTab) {
  switch (tab) {
    case "ai":
      return Zap;
    case "preferences":
      return SlidersHorizontal;
    case "permissions":
      return FolderLock;
    case "cloud-marketplaces":
      return Store;
    case "cloud-providers":
      return CloudCog;
    case "extensions":
      return Puzzle;
    case "environment":
      return Terminal;
    case "updates":
      return RefreshCcw;
    case "memory":
      return UserCircle;
    case "conversation-memory":
      return Brain;
    case "archived-tasks":
      return Archive;
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
    case "cloud-marketplaces":
      return t("settings.tab_cloud_marketplaces");
    case "cloud-providers":
      return t("settings.tab_cloud_providers");
    case "extensions":
      return t("settings.tab_extensions");
    case "environment":
      return t("settings.tab_environment");
    case "updates":
      return t("settings.tab_updates");
    case "memory":
      return t("settings.tab_memory");
    case "conversation-memory":
      return t("settings.tab_conversation_memory");
    case "archived-tasks":
      return t("settings.tab_archived_tasks");
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
    case "cloud-marketplaces":
      return t("settings.tab_description_cloud_marketplaces");
    case "cloud-providers":
      return t("settings.tab_description_cloud_providers");
    case "extensions":
      return t("settings.tab_description_extensions");
    case "environment":
      return t("settings.tab_description_environment");
    case "updates":
      return t("settings.tab_description_updates");
    case "memory":
      return t("settings.tab_description_memory");
    case "conversation-memory":
      return t("settings.tab_description_conversation_memory");
    case "archived-tasks":
      return t("settings.tab_description_archived_tasks");
    case "debug":
      return t("settings.tab_description_debug");
    case "general":
      return t("settings.tab_description_setting_general");
    default:
      return t("settings.tab_description_general");
  }
}

export function getWorkspaceSettingsTabs(): SettingsTab[] {
  return [
    "general",
    "preferences",
    "memory",
    "conversation-memory",
    "permissions",
  ];
}

export function getArchivedSettingsTabs(): SettingsTab[] {
  return ["archived-tasks"];
}

export function getGlobalSettingsTabs(developerMode: boolean): SettingsTab[] {
  const tabs: SettingsTab[] = ["ai", "environment", "updates"];
  if (developerMode) tabs.push("debug");
  return tabs;
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
  label: string;
  tabs: SettingsTab[];
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
}) {
  if (props.tabs.length === 0) return null;
  return (
    <SidebarGroup className="px-0 py-2">
      <SidebarGroupLabel className={settingsSidebarGroupLabelClass}>
        {props.label}
      </SidebarGroupLabel>
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
  const workspaceTabs = getWorkspaceSettingsTabs();
  const archivedTabs = getArchivedSettingsTabs();
  const globalTabs = getGlobalSettingsTabs(props.developerMode);

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
        <SettingsNavGroup
          label={t("settings.group_workspace")}
          tabs={workspaceTabs}
          activeTab={props.activeTab}
          onSelectTab={props.onSelectTab}
        />
        <SettingsNavGroup
          label={t("settings.group_global")}
          tabs={globalTabs}
          activeTab={props.activeTab}
          onSelectTab={props.onSelectTab}
        />
        <SettingsNavGroup
          label={t("settings.group_archived")}
          tabs={archivedTabs}
          activeTab={props.activeTab}
          onSelectTab={props.onSelectTab}
        />
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
