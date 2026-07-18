/** @jsxImportSource react */
import type * as React from "react";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import {
  SettingsPage,
  SettingsSidebar,
  getArchivedSettingsTabs,
  getGlobalSettingsTabs,
  getSettingsTabDescription,
  getSettingsTabIcon,
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
} from "./settings-page";
import { WorkspaceIcon } from "../../../design-system/workspace-icon";
import { SettingsNotice } from "../settings-section";

type SettingsPageFrameProps = Omit<
  React.ComponentProps<typeof SettingsPage>,
  "children"
>;

export type SettingsShellProps = SettingsPageFrameProps & {
  selectedWorkspaceId: string;
  selectedWorkspaceName: string;
  selectedWorkspaceColor: string;
  workspaces: Array<{ id: string; name: string; color: string }>;
  headerStatus?: string;
  busyHint?: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  onClose: () => void;
  headerLeadingSlot?: React.ReactNode;
  panelToolbarSlot?: React.ReactNode;
  children: React.ReactNode;
  error?: string | null;
  errorSlot?: React.ReactNode;
  modalSlot?: React.ReactNode;
  footer?: React.ReactNode;
  compact?: boolean;
};

const settingsShellClass = {
  // Canvas lane: cool work surface; cards sit on dls-surface inside.
  compactRoot: "flex h-full min-h-0 w-full flex-col overflow-hidden bg-dls-background",
  compactHeader: "flex h-11 shrink-0 items-center justify-between gap-2 border-b border-dls-border px-3 mac:titlebar-drag",
  compactMenuGroup: "flex min-w-0 items-center gap-2 mac:titlebar-no-drag",
  titlebarActions: "flex shrink-0 items-center gap-2 mac:titlebar-no-drag",
  closeButton: "shrink-0 rounded-md text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
  main: "flex min-h-0 flex-1 flex-col overflow-hidden",
  errorCompact: "mx-auto w-full max-w-3xl px-4 pb-6",
  errorFull: "mx-auto max-w-5xl px-6 pb-24 md:px-10 md:pb-10",
  errorNotice: "flex flex-col gap-y-3",
  // Full settings: sidebar lane + canvas; opaque fills avoid warm wallpaper bleed.
  root: "flex h-dvh min-h-screen w-full overflow-hidden bg-dls-background",
  provider: "relative min-h-0 flex-1 bg-dls-background",
  inset:
    "min-h-0 overflow-hidden bg-dls-background mac:[&_header]:transition-[padding-left] mac:[&_header]:duration-200 mac:[&_header]:ease-linear mac:peer-data-[state=collapsed]:[&_header]:pl-16 [&_header]:pl-16 md:[&_header]:pl-6",
  contentMain: "flex min-w-0 flex-1 flex-col overflow-hidden bg-dls-background",
  header: "flex min-h-16 shrink-0 items-center justify-between gap-4 px-4 py-3 md:px-10 mac:titlebar-drag",
  headerTitleGroup: "flex min-w-0 flex-1 items-center gap-3",
  title: "truncate text-xl font-medium leading-7 text-dls-text",
  subtitle: "mt-0.5 truncate text-sm leading-5 text-dls-secondary",
  headerMeta: "hidden text-xs text-dls-secondary lg:inline",
  mobileCloseButton:
    "flex size-9 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-list-hover hover:text-dls-text md:hidden",
  sectionTrigger: "min-w-0 max-w-46 justify-start gap-2",
  workspaceTrigger: "min-w-0 max-w-36 justify-start gap-2 text-dls-secondary",
};

export function SettingsShell(props: SettingsShellProps) {
  const title = getSettingsTabLabel(props.activeTab);
  const subtitle = getSettingsTabDescription(props.activeTab);

  if (props.compact) {
    return (
      <div className={settingsShellClass.compactRoot}>
        <header className={settingsShellClass.compactHeader}>
          <div className={settingsShellClass.compactMenuGroup}>
            <SettingsSectionMenu
              activeTab={props.activeTab}
              developerMode={props.developerMode}
              onSelectTab={props.onSelectTab}
            />
            <WorkspaceMenu
              selectedWorkspaceId={props.selectedWorkspaceId}
              selectedWorkspaceName={props.selectedWorkspaceName}
              workspaces={props.workspaces}
              onSelectWorkspace={props.onSelectWorkspace}
            />
          </div>
          <div className={settingsShellClass.titlebarActions}>
            {props.panelToolbarSlot}
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              className={settingsShellClass.closeButton}
              onClick={props.onClose}
              title={t("dashboard.close_settings")}
              aria-label={t("dashboard.close_settings")}
            >
              <X size={16} />
            </Button>
          </div>
        </header>

        <main className={settingsShellClass.main}>
          <div className={settingsShellClass.main}>
            <SettingsPage {...props} panelToolbarSlot={undefined}>{props.children}</SettingsPage>

            {props.error ? (
              <div className={settingsShellClass.errorCompact}>
                <SettingsNotice tone="error" className={settingsShellClass.errorNotice}>
                  <div>{props.error}</div>
                  {props.errorSlot}
                </SettingsNotice>
              </div>
            ) : null}

            {props.modalSlot}
          </div>

          {props.footer}
        </main>
      </div>
    );
  }

  return (
    <div className={settingsShellClass.root}>
      <SidebarProvider
        open={true}
        className={settingsShellClass.provider}
        style={{ "--sidebar-width": "260px" } as React.CSSProperties}
      >
        <SettingsSidebar
          activeTab={props.activeTab}
          onSelectTab={props.onSelectTab}
          developerMode={props.developerMode}
          onClose={props.onClose}
        />
        <SidebarInset className={settingsShellClass.inset}>
          <main className={settingsShellClass.contentMain}>
            <header className={settingsShellClass.header}>
              <div className={settingsShellClass.headerTitleGroup}>
                <SidebarTrigger className="mac:titlebar-no-drag md:hidden" />
                {props.headerLeadingSlot}
                <div className="min-w-0">
                  <h1 className={settingsShellClass.title}>
                    {title}
                  </h1>
                  <p className={settingsShellClass.subtitle}>
                    {subtitle}
                  </p>
                </div>
                {props.developerMode && props.headerStatus ? (
                  <span className={settingsShellClass.headerMeta}>
                    {props.headerStatus}
                  </span>
                ) : null}
                {props.busyHint ? (
                  <span className={settingsShellClass.headerMeta}>
                    {props.busyHint}
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-dls-secondary mac:titlebar-no-drag">
                {props.panelToolbarSlot}
                <Button
                  variant="ghost"
                  type="button"
                  className={settingsShellClass.mobileCloseButton}
                  onClick={props.onClose}
                  title={t("dashboard.close_settings")}
                  aria-label={t("dashboard.close_settings")}
                >
                  <X size={16} />
                </Button>
              </div>
            </header>

            <div className={settingsShellClass.main}>
              <SettingsPage {...props} panelToolbarSlot={undefined}>{props.children}</SettingsPage>

              {props.error ? (
                <div className={settingsShellClass.errorFull}>
                  <SettingsNotice tone="error" className={settingsShellClass.errorNotice}>
                    <div>{props.error}</div>
                    {props.errorSlot}
                  </SettingsNotice>
                </div>
              ) : null}

              {props.modalSlot}
            </div>

            {props.footer}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

function SettingsSectionMenu(
  props: Pick<
    SettingsPageFrameProps,
    "activeTab" | "developerMode" | "onSelectTab"
  >,
) {
  const sections: Array<{ label: string | null; tabs: SettingsTab[] }> = [
    { label: t("settings.group_workspace"), tabs: getWorkspaceSettingsTabs() },
    {
      label: t("settings.group_global"),
      tabs: getGlobalSettingsTabs(props.developerMode),
    },
    { label: t("settings.group_archived"), tabs: getArchivedSettingsTabs() },
  ];
  const ActiveIcon = getSettingsTabIcon(props.activeTab);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={settingsShellClass.sectionTrigger}
          >
            <ActiveIcon className="size-4 shrink-0" />
            <span className="truncate">
              {getSettingsTabLabel(props.activeTab)}
            </span>
            <ChevronDown className="ml-auto size-4 shrink-0" />
          </Button>
        }
      />
      <DropdownMenuContent className="w-64">
        {sections.map((section, index) => (
          <DropdownMenuGroup key={section.label ?? "root"}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {section.label ? (
              <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
            ) : null}
            {section.tabs.map((tab) => {
              const Icon = getSettingsTabIcon(tab);
              return (
                <DropdownMenuItem
                  key={tab}
                  onClick={() => props.onSelectTab(tab)}
                  className={
                    props.activeTab === tab
                      ? "bg-foreground/10 text-accent-foreground"
                      : undefined
                  }
                >
                  <Icon />
                  <span>{getSettingsTabLabel(tab)}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceMenu(
  props: Pick<
    SettingsShellProps,
    | "selectedWorkspaceId"
    | "selectedWorkspaceName"
    | "workspaces"
    | "onSelectWorkspace"
  >,
) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={settingsShellClass.workspaceTrigger}
          >
            <WorkspaceIcon
              seed={props.selectedWorkspaceName}
              sizeClass="size-4"
            />
            <span className="truncate">{props.selectedWorkspaceName}</span>
            <ChevronDown className="ml-auto size-4 shrink-0" />
          </Button>
        }
      />
      <DropdownMenuContent className="w-56">
        {props.workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => props.onSelectWorkspace(workspace.id)}
            disabled={workspace.id === props.selectedWorkspaceId}
          >
            <WorkspaceIcon seed={workspace.name} sizeClass="size-4" />
            <span className="truncate">{workspace.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
