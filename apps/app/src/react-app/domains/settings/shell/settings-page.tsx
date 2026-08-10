/** @jsxImportSource react */
import { ArrowLeft } from "lucide-react";

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
import { prefetchSettingsTab } from "../settings-tab-prefetch";
import {
  getSettingsNavSections,
  getSettingsTabIcon,
  getSettingsTabLabel,
  type SettingsNavSectionDef,
} from "../settings-tab-meta";
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

/**
 * Re-export tab metadata for backwards compatibility with existing consumers.
 * The canonical home is ../settings-tab-meta (kept free of shell/lazy imports).
 */
export {
  getArchivedSettingsTabs,
  getDataSettingsTabs,
  getGlobalSettingsTabs,
  getOverviewSettingsTabs,
  getPersonalMemorySettingsTabs,
  getSettingsNavSections,
  getSettingsTabDescription,
  getSettingsTabIcon,
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
  type SettingsNavSectionDef,
} from "../settings-tab-meta";

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
                  onPointerEnter={() => prefetchSettingsTab(tab)}
                  onFocus={() => prefetchSettingsTab(tab)}
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
