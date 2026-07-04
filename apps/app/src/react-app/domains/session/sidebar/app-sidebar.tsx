/** @jsxImportSource react */
import * as React from "react";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  CircleHelp,
  FileText,
  Globe2,
  Info,
  KeyRound,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Moon,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Trash2,
  RefreshCw,
  RotateCcw,
  Settings,
  Network,
  Sun,
  UserRound,
} from "lucide-react";

import {
  getDisplaySessionTitle,
  isGeneratedSessionTitle,
} from "../../../../app/lib/session-title";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import {
  getInitialThemeMode,
  setThemeMode as setAppThemeMode,
  subscribeToTheme,
  type ThemeMode,
} from "../../../../app/theme";
import { APP_NAME } from "../../../../i18n/locales/brand";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import { OnMyAgentDenHelpLink } from "../../shared/onmyagent-den-help-link";
import type {
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import {
  isRemoteConnectionErrorMessage,
  getWorkspaceTaskLoadErrorDisplay,
  isRemoteConnectionWorkspace,
} from "../../../../app/utils";
import {
  currentLocale,
  LANGUAGE_OPTIONS,
  setLocale,
  t,
  type Language,
} from "../../../../i18n";

import {
  Sidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";

import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { SidebarContext, useSidebarContext } from "./app-sidebar-provider";
import type { SidebarContextValue } from "./app-sidebar-provider";
import {
  MAX_SESSIONS_PREVIEW,
  buildSessionTreeState,
  getRootSessions,
  isStreamingSessionStatus,
} from "./utils";
import type { SessionListItem, SessionTreeState } from "./utils";
import { cn } from "@/lib/utils";
import {
  getSessionActivityStatusLabel,
  type SessionActivityStatus,
} from "../status/session-activity-store";

const sidebarAccountMenuRowClass =
  "h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-sidebar-foreground hover:!bg-dls-hover hover:!text-dls-text focus:!bg-dls-hover focus:!text-dls-text data-highlighted:!bg-dls-hover data-highlighted:!text-dls-text data-open:!bg-dls-hover data-open:!text-dls-text data-popup-open:!bg-dls-hover data-popup-open:!text-dls-text data-state-open:!bg-dls-hover data-state-open:!text-dls-text aria-expanded:!bg-dls-hover aria-expanded:!text-dls-text [&_svg]:text-current";

const appSidebarTextClass = {
  noticeTitle: "text-xs font-medium text-dls-text",
  noticeDescription: "mt-1 text-xs leading-5 text-dls-secondary",
  billingTitle: "text-sm font-medium text-sidebar-foreground",
  billingUsage: "text-sm font-medium",
  accountName: "block truncate text-sm font-medium",
  accountEmail: "block truncate text-xs text-sidebar-foreground/55",
  brand: "truncate text-xl font-medium leading-none text-sidebar-foreground",
  groupLabel: "flex h-8 w-full items-center gap-2 px-2 text-left text-sm font-medium text-sidebar-foreground/45",
};

const appSidebarStateClass = {
  issueCard: "w-full rounded-lg border border-dls-status-danger-border bg-dls-status-danger-soft px-3 py-3 text-left",
  issueCardOffline: "border-dls-status-warning-border bg-dls-status-warning-soft",
  issueIcon: "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dls-status-danger-soft text-dls-status-danger-fg",
  issueIconOffline: "bg-dls-status-warning-soft text-dls-status-warning-fg",
  issueMessage: "mt-2 rounded-lg border border-dls-status-danger-border bg-dls-status-danger-soft px-2 py-1.5 text-xs leading-4 text-dls-status-danger-fg whitespace-pre-wrap wrap-anywhere",
  issueMessageOffline: "border-dls-status-warning-border bg-dls-status-warning-soft text-dls-status-warning-fg",
  waiting: "bg-dls-signal",
  waitingText: "text-dls-accent",
  error: "bg-dls-status-danger",
  errorText: "text-dls-status-danger",
  compacting: "bg-dls-accent",
  compactingText: "text-dls-accent",
  active: "bg-dls-status-warning",
  activeText: "text-dls-status-warning",
};

const sidebarAccountMenuGridClass = cn(
  "grid grid-cols-[16px_minmax(0,1fr)_12px]",
  sidebarAccountMenuRowClass,
);

const sidebarAccountSubTriggerClass = cn(
  sidebarAccountMenuGridClass,
  "data-popup-open:!bg-dls-decision-soft data-popup-open:!text-dls-accent data-open:!bg-dls-decision-soft data-open:!text-dls-accent aria-expanded:!bg-dls-decision-soft aria-expanded:!text-dls-accent [&>svg:last-child]:hidden",
);

function SessionStatusIndicator(props: {
  status?: string;
  isStreaming: boolean;
  isActive: boolean;
}) {
  const activityTitle =
    isSessionActivityStatus(props.status) && props.status !== "idle"
      ? getSessionActivityStatusLabel(props.status)
      : undefined;
  const title =
    activityTitle ??
    (props.isStreaming
      ? t("workspace_list.session_streaming")
      : t("workspace_list.session_active"));

  if (props.isStreaming) {
    return (
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center",
          sessionActivityTextClass(props.status),
        )}
        title={title}
        aria-label={title}
      >
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    );
  }

  if (props.isActive) {
    return (
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          sessionActivityDotClass(props.status),
        )}
        title={title}
        aria-label={title}
      />
    );
  }

  return null;
}

type SessionActionsProps = {
  className: string;
  sessionId: string;
};

function SessionActions({ className, sessionId }: SessionActionsProps) {
  const ctx = useSidebarContext();
  const canManage = Boolean(
    ctx.showSessionActions &&
    (ctx.onOpenRenameSession || ctx.onOpenDeleteSession),
  );

  if (!canManage) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="size-6 text-muted-foreground"
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("size-6", className)}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        alignOffset={-4}
        className="w-56"
      >
        {ctx.onOpenRenameSession ? (
          <DropdownMenuItem
            onClick={() => ctx.onOpenRenameSession?.(sessionId)}
          >
            <Pencil className="size-4" />
            {t("workspace_list.rename_session")}
          </DropdownMenuItem>
        ) : null}
        {ctx.onOpenDeleteSession ? (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => ctx.onOpenDeleteSession?.(sessionId)}
          >
            <Trash2 className="size-4" />
            {t("workspace_list.delete_session")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SessionContextMenuProps = {
  children: React.ReactElement;
  sessionId: string;
};

function SessionContextMenu({ children, sessionId }: SessionContextMenuProps) {
  const ctx = useSidebarContext();
  const canManage = Boolean(
    ctx.showSessionActions &&
    (ctx.onOpenRenameSession || ctx.onOpenDeleteSession),
  );

  if (!canManage) return children;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-56">
        {ctx.onOpenRenameSession ? (
          <ContextMenuItem onClick={() => ctx.onOpenRenameSession?.(sessionId)}>
            <Pencil className="size-4" />
            {t("workspace_list.rename_session")}
          </ContextMenuItem>
        ) : null}
        {ctx.onOpenDeleteSession ? (
          <ContextMenuItem
            variant="destructive"
            onClick={() => ctx.onOpenDeleteSession?.(sessionId)}
          >
            <Trash2 className="size-4" />
            {t("workspace_list.delete_session")}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RemoteConnectionIssueCard(props: {
  message: string;
  tone: "error" | "offline";
  canRecover: boolean;
  busy: boolean;
  onRecover: () => void;
  onTest: () => void;
  onEdit: () => void;
}) {
  const isOffline = props.tone === "offline";

  return (
    <SidebarMenuSubItem>
      <div
        className={cn(
          appSidebarStateClass.issueCard,
          isOffline && appSidebarStateClass.issueCardOffline,
        )}
      >
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              appSidebarStateClass.issueIcon,
              isOffline && appSidebarStateClass.issueIconOffline,
            )}
          >
            <AlertCircle size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className={appSidebarTextClass.noticeTitle}>
              {t("workspace_list.remote_worker_unavailable")}
            </div>
            <div className={appSidebarTextClass.noticeDescription}>
              {t("workspace_list.remote_worker_unavailable_hint")}
            </div>
            <div
              className={cn(
                appSidebarStateClass.issueMessage,
                isOffline && appSidebarStateClass.issueMessageOffline,
              )}
              title={props.message}
            >
              {props.message}
            </div>
            <OnMyAgentDenHelpLink />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {props.canRecover ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 rounded-lg px-2 text-xs"
                  onClick={props.onRecover}
                  disabled={props.busy}
                >
                  <RotateCcw size={12} />
                  {t("workspace_list.recover")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2 text-xs"
                onClick={props.onTest}
                disabled={props.busy}
              >
                <RefreshCw size={12} />
                {t("workspace_list.test_connection")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2 text-xs"
                onClick={props.onEdit}
                disabled={props.busy}
              >
                <Settings size={12} />
                {t("common.edit")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SidebarMenuSubItem>
  );
}

export type AppSidebarProps = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  showInitialLoading?: boolean;
  selectedWorkspaceId: string;
  developerMode: boolean;
  selectedSessionId: string | null;
  showSessionActions?: boolean;
  sessionStatusById?: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  onSelectWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onOpenRenameSession?: (sessionId: string) => void;
  onOpenDeleteSession?: (sessionId: string) => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onShareWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onRecoverWorkspace: (
    workspaceId: string,
  ) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (
    workspaceId: string,
  ) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  onReorderWorkspaces?: (workspaceIds: string[]) => void;
  onStartResize?: React.PointerEventHandler<HTMLButtonElement>;
  activeView: SidebarPrimaryView;
  onOpenPrimaryView: (view: SidebarPrimaryView) => void;
  account?: SidebarAccountInfo | null;
  onOpenAccountSettings?: () => void;
  onSignOut?: () => void;
  onOpenBilling?: () => void;
};

export type SidebarAccountInfo = {
  name: string;
  email?: string | null;
};

export type SidebarPrimaryView =
  | "chat"
  | "billing"
  | "agents"
  | "skills"
  | "connectors"
  | "devices"
  | "scheduledTasks"
  | "channels"
  | "personalAssistant";

type SidebarMenuConfig = {
  id: SidebarPrimaryView;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PRIMARY_MENU_ITEMS: SidebarMenuConfig[] = [
  { id: "chat", get label() { return t("session.new_task"); }, icon: Plus },
  { id: "agents", get label() { return t("nav.agents"); }, get description() { return t("nav.agents_desc"); }, icon: Bot },
  { id: "skills", get label() { return t("nav.skills"); }, get description() { return t("nav.skills_desc"); }, icon: FileText },
  {
    id: "connectors",
    get label() { return t("nav.connectors"); },
    get description() { return t("nav.connectors_desc"); },
    icon: KeyRound,
  },
  {
    id: "scheduledTasks",
    label: "",
    get description() { return t("nav.automation_desc"); },
    icon: Clock3,
  },
  {
    id: "channels",
    label: "",
    get description() { return t("nav.channels_desc"); },
    icon: Network,
  },
  {
    id: "personalAssistant",
    get label() { return t("nav.personal_assistant"); },
    get description() { return t("nav.personal_assistant_desc"); },
    icon: UserRound,
  },
];

function useSessionTree(
  sessions: WorkspaceSessionGroup["sessions"],
  sessionStatusById: Record<string, string> | undefined,
) {
  return React.useMemo(
    () => buildSessionTreeState(sessions, sessionStatusById),
    [sessions, sessionStatusById],
  );
}

function isSessionActivityStatus(
  status: string | undefined,
): status is SessionActivityStatus {
  return (
    status === "idle" ||
    status === "thinking" ||
    status === "responding" ||
    status === "error" ||
    status === "compacting" ||
    status === "waiting"
  );
}

function sessionActivityDotClass(status: string | undefined) {
  if (status === "waiting") return appSidebarStateClass.waiting;
  if (status === "error") return appSidebarStateClass.error;
  if (status === "compacting") return appSidebarStateClass.compacting;
  if (status === "responding") return "bg-dls-accent";
  return appSidebarStateClass.active;
}

function sessionActivityTextClass(status: string | undefined) {
  if (status === "waiting") return appSidebarStateClass.waitingText;
  if (status === "error") return appSidebarStateClass.errorText;
  if (status === "compacting") return appSidebarStateClass.compactingText;
  if (status === "responding") return "text-dls-accent";
  return appSidebarStateClass.activeText;
}

function isEmptyDraftSession(
  session: SessionListItem,
  status: string | undefined,
) {
  const title = session.title?.trim() ?? "";
  return (
    (!title || isGeneratedSessionTitle(title)) &&
    !isSessionActivityStatus(status)
  );
}

function getVisibleSidebarSessions(
  sessions: WorkspaceSessionGroup["sessions"],
  sessionStatusById: Record<string, string> | undefined,
  selectedSessionId: string | null | undefined,
) {
  return sessions.filter(
    (session) =>
      session.id === selectedSessionId ||
      !isEmptyDraftSession(session, sessionStatusById?.[session.id]),
  );
}

function getVisibleTaskCount(
  workspaceSessionGroups: WorkspaceSessionGroup[],
  selectedWorkspaceId: string,
  sessionStatusById: Record<string, string> | undefined,
  selectedSessionId: string | null,
) {
  const group = workspaceSessionGroups.find(
    (g) => g.workspace.id === selectedWorkspaceId,
  );
  if (!group) return 0;
  const visibleSessions = getVisibleSidebarSessions(
    group.sessions,
    sessionStatusById,
    selectedSessionId,
  );
  return getRootSessions(visibleSessions).length;
}

export function AppSidebar(props: AppSidebarProps) {
  const [sessionsOpen, setSessionsOpen] = React.useState(true);
  const [teamOpen, setTeamOpen] = React.useState(true);
  const [previewCountByWorkspaceId, setPreviewCountByWorkspaceId] =
    React.useState<Record<string, number>>({});
  const [expandedSessionIds, setExpandedSessionIds] = React.useState<
    Set<string>
  >(() => new Set());

  const expandWorkspace = React.useCallback((workspaceId: string) => {
    const id = workspaceId.trim();
    if (!id) return;
  }, []);

  const toggleWorkspaceExpanded = React.useCallback((workspaceId: string) => {
    const id = workspaceId.trim();
    if (!id) return;
  }, []);

  const toggleSessionExpanded = React.useCallback((sessionId: string) => {
    const id = sessionId.trim();
    if (!id) return;
    setExpandedSessionIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    const id = props.selectedWorkspaceId.trim();
    if (!id) return;
    expandWorkspace(id);
  }, [props.selectedWorkspaceId, expandWorkspace]);

  const previewCount = (workspaceId: string) =>
    previewCountByWorkspaceId[workspaceId] ?? MAX_SESSIONS_PREVIEW;

  const showMoreSessions = (workspaceId: string, totalRoots: number) => {
    expandWorkspace(workspaceId);
    setPreviewCountByWorkspaceId((current) => ({
      ...current,
      [workspaceId]: Math.min(
        (current[workspaceId] ?? MAX_SESSIONS_PREVIEW) + MAX_SESSIONS_PREVIEW,
        totalRoots,
      ),
    }));
  };

  React.useEffect(() => {
    const workspaceId = props.selectedWorkspaceId.trim();
    if (!workspaceId) return;

    const group = props.workspaceSessionGroups.find(
      (entry) => entry.workspace.id === workspaceId,
    );
    if (!group?.sessions.length) return;

    const selectedId = props.selectedSessionId?.trim() ?? "";
    const selectedIndex = selectedId
      ? group.sessions.findIndex((session) => session.id === selectedId)
      : -1;
    const start = selectedIndex >= 0 ? Math.max(0, selectedIndex - 2) : 0;
    const end =
      selectedIndex >= 0
        ? Math.min(group.sessions.length, selectedIndex + 3)
        : Math.min(group.sessions.length, 4);

    group.sessions.slice(start, end).forEach((session) => {
      props.onPrefetchSession?.(workspaceId, session.id);
    });
  }, [
    props.onPrefetchSession,
    props.selectedSessionId,
    props.selectedWorkspaceId,
    props.workspaceSessionGroups,
  ]);

  const contextValue: SidebarContextValue = {
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    activeView: props.activeView,
    developerMode: props.developerMode,
    showSessionActions: props.showSessionActions,
    sessionStatusById: props.sessionStatusById,
    newTaskDisabled: props.newTaskDisabled,
    connectingWorkspaceId: props.connectingWorkspaceId,
    workspaceConnectionStateById: props.workspaceConnectionStateById,
    onSelectWorkspace: props.onSelectWorkspace,
    onOpenSession: props.onOpenSession,
    onPrefetchSession: props.onPrefetchSession,
    onCreateTaskInWorkspace: props.onCreateTaskInWorkspace,
    onOpenRenameSession: props.onOpenRenameSession,
    onOpenDeleteSession: props.onOpenDeleteSession,
    onOpenRenameWorkspace: props.onOpenRenameWorkspace,
    onShareWorkspace: props.onShareWorkspace,
    onRevealWorkspace: props.onRevealWorkspace,
    onRecoverWorkspace: props.onRecoverWorkspace,
    onTestWorkspaceConnection: props.onTestWorkspaceConnection,
    onEditWorkspaceConnection: props.onEditWorkspaceConnection,
    onForgetWorkspace: props.onForgetWorkspace,
    expandWorkspace,
    toggleWorkspaceExpanded,
    toggleSessionExpanded,
    expandedWorkspaceIds: new Set(
      props.workspaceSessionGroups.map((group) => group.workspace.id),
    ),
    expandedSessionIds,
  };

  const openPrimaryView = (view: SidebarPrimaryView) => {
    props.onOpenPrimaryView(view);
    if (view === "chat") {
      props.onCreateTaskInWorkspace(props.selectedWorkspaceId);
    }
  };

  const hasSelectedSession = Boolean(props.selectedSessionId?.trim());

  return (
    <SidebarContext.Provider value={contextValue}>
      <Sidebar
        collapsible="offcanvas"
        className="mac:**:data-[sidebar=sidebar]:bg-transparent"
      >
        <div className="hidden h-14 mac:block mac:titlebar-drag" />
        <div
          data-slot="sidebar-content"
          data-sidebar="content"
          className="flex min-h-0 flex-1 flex-col overflow-auto px-3 pb-4 group-data-[collapsible=icon]:overflow-hidden"
        >
          <SidebarBrand />
          <SidebarMenu className="gap-0.5">
            {PRIMARY_MENU_ITEMS.map((item) => (
              <PrimaryMenuItem
                key={item.id}
                item={item}
                active={
                  item.id === "chat"
                    ? props.activeView === "chat" && !hasSelectedSession
                    : props.activeView === item.id
                }
                disabled={item.id === "chat" && props.newTaskDisabled}
                onClick={() => openPrimaryView(item.id)}
              />
            ))}
          </SidebarMenu>

          <Collapsible
            open={sessionsOpen}
            onOpenChange={setSessionsOpen}
            className="mt-8"
          >
            <SidebarSectionTrigger
              label={t("nav.tasks")}
              open={sessionsOpen}
              count={getVisibleTaskCount(
                props.workspaceSessionGroups,
                props.selectedWorkspaceId,
                props.sessionStatusById,
                props.selectedSessionId,
              )}
            />
            <CollapsibleContent className="mt-3 space-y-1">
              {props.workspaceSessionGroups
                .filter(
                  (group) => group.workspace.id === props.selectedWorkspaceId,
                )
                .map((group) => (
                  <SessionListForWorkspace
                    key={group.workspace.id}
                    group={group}
                    showInitialLoading={props.showInitialLoading}
                    previewCount={previewCount(group.workspace.id)}
                    showMoreSessions={showMoreSessions}
                  />
                ))}
            </CollapsibleContent>
          </Collapsible>

          <Collapsible
            open={teamOpen}
            onOpenChange={setTeamOpen}
            className="mt-8"
          >
            <SidebarSectionTrigger label={t("nav.team")} open={teamOpen} badge="Beta" />
            <CollapsibleContent className="mt-3 space-y-1">
              {teamOpen && (
                <div className="px-12 py-2 text-sm text-sidebar-foreground/50">
                  {t("nav.no_team")}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        <SidebarFooter>
          <div className="space-y-1 pb-2">
            <div className="flex items-stretch gap-1">
              <div className="min-w-0 flex-1">
                <SidebarAccountButton
                  account={props.account || undefined}
                  onOpenSettings={props.onOpenAccountSettings}
                  onSignOut={props.onSignOut}
                  onOpenBilling={props.onOpenBilling}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                className={cn(
                  "shrink-0 border-sidebar-border/70 bg-dls-rail-hover text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  props.activeView === "devices" &&
                    "border-dls-accent/30 bg-dls-accent/10 text-dls-accent hover:bg-dls-accent/10 hover:text-dls-accent",
                )}
                onClick={() => props.onOpenPrimaryView("devices")}
                title={t("nav.devices")}
                aria-label={t("nav.devices")}
                aria-pressed={props.activeView === "devices"}
              >
                <MonitorSmartphone className="size-5" />
              </Button>
            </div>
          </div>
        </SidebarFooter>
        <SidebarRail
          aria-label={
            props.onStartResize
              ? t("session.resize_workspace_column")
              : undefined
          }
          title={
            props.onStartResize
              ? t("session.resize_workspace_column")
              : undefined
          }
          onClick={
            props.onStartResize
              ? (event) => {
                  event.preventDefault();
                }
              : undefined
          }
          onPointerDown={props.onStartResize}
        />
      </Sidebar>
    </SidebarContext.Provider>
  );
}

export function SidebarAccountButton(props: {
  account?: SidebarAccountInfo;
  onOpenDevices?: () => void;
  onOpenSettings?: () => void;
  onSignOut?: () => void;
  onOpenBilling?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = React.useState(false);
  const [language, setLanguageState] = React.useState<Language>(() =>
    currentLocale(),
  );
  const [themeMode, setThemeModeState] = React.useState<ThemeMode>(() =>
    getInitialThemeMode(),
  );
  const [localUser] = React.useState(() => readLocalAuthUser());
  const account = localUser
    ? { name: localUser.username, email: localUser.email }
    : props.account;
  const initial = (account?.name || account?.email || "xxx")
    .charAt(0)
    .toUpperCase();

  React.useEffect(
    () => subscribeToTheme(() => setThemeModeState(getInitialThemeMode())),
    [],
  );

  const setLanguage = (value: Language) => {
    setLocale(value);
    setLanguageState(value);
  };

  const setThemeMode = (value: ThemeMode) => {
    setAppThemeMode(value);
    setThemeModeState(value);
  };

  const menuContent = (
    <>
      <div className="hidden p-3 pb-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            props.onOpenBilling?.();
          }}
          className="hidden w-full rounded-lg bg-sidebar-accent/40 p-3 text-left transition-colors hover:bg-sidebar-accent/70"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className={appSidebarTextClass.billingTitle}>
              {t("account_menu.free_plan")}
            </span>
            <StatusBadge size="sm" className="bg-muted text-muted-foreground">
              {t("account_menu.view_details")}
            </StatusBadge>
          </div>
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[28%] rounded-full bg-dls-accent" />
          </div>
          <div className="flex items-center justify-between gap-3 text-sidebar-foreground">
            <span className={appSidebarTextClass.billingUsage}>
              146 / 520 {t("account_menu.credits")}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {t("account_menu.used_percent")}
              </span>
            </span>
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </div>
        </button>
      </div>
      <div className="px-1.5 py-1.5">
        <SidebarAccountSubMenu
          icon={Globe2}
          label={t("account_menu.language")}
          items={LANGUAGE_OPTIONS.map((option) => ({
            value: option.value,
            label:
              option.value === "zh"
                ? t("account_menu.language_chinese")
                : option.nativeName,
          }))}
          selectedValue={language}
          onSelect={(value) => setLanguage(value as Language)}
        />
        <SidebarAccountSubMenu
          icon={Palette}
          label={t("account_menu.theme")}
          items={[
            {
              value: "light",
              label: t("account_menu.theme_light"),
              icon: Sun,
            },
            {
              value: "dark",
              label: t("account_menu.theme_dark"),
              icon: Moon,
            },
            {
              value: "system",
              label: t("account_menu.theme_system"),
              icon: Globe2,
            },
          ]}
          selectedValue={themeMode}
          onSelect={(value) => setThemeMode(value as ThemeMode)}
        />
        {props.onOpenDevices ? (
          <SidebarAccountMenuItem
            icon={MonitorSmartphone}
            label={t("nav.devices")}
            onSelect={() => {
              setOpen(false);
              props.onOpenDevices?.();
            }}
          />
        ) : null}
        <SidebarAccountMenuItem
          icon={Settings}
          label={t("account_menu.settings")}
          onSelect={() => {
            setOpen(false);
            props.onOpenSettings?.();
          }}
        />
      </div>
    </>
  );

  if (props.compact) {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="text-dls-secondary hover:text-dls-accent"
              title={t("account_menu.settings")}
              aria-label={t("account_menu.settings")}
            >
              <Settings className="size-5" />
            </Button>
          }
        />
        <DropdownMenuContent
          align="center"
          side="right"
          sideOffset={12}
          className="w-48 rounded-lg border-sidebar-border/70 bg-dls-surface p-0"
        >
          {menuContent}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="w-full"
        render={
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className={cn(
              "h-auto w-full justify-start gap-3 border border-sidebar-border/70 bg-sidebar-accent/50 px-3 py-3 text-left text-sidebar-foreground hover:bg-sidebar-accent",
            )}
          >
            <IconTile size="sm" shape="circle" tone="softAccent" className="bg-dls-accent text-xs font-medium text-white">
              {initial}
            </IconTile>
            <span className="min-w-0 flex-1">
              <span className={appSidebarTextClass.accountName}>
                {account?.name || "..."}
              </span>
              {account?.email ? (
                <span className={appSidebarTextClass.accountEmail}>
                  {account.email}
                </span>
              ) : null}
            </span>
            <ChevronDown className="size-4 shrink-0 text-sidebar-foreground/55" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-48 rounded-lg border-sidebar-border/70 bg-dls-surface p-0"
      >
        {menuContent}
      </DropdownMenuContent>
      <ConfirmModal
        open={signOutConfirmOpen}
        title={t("account_menu.sign_out_confirm_title")}
        message={t("account_menu.sign_out_confirm_message")}
        confirmLabel={t("account_menu.sign_out")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onCancel={() => setSignOutConfirmOpen(false)}
        onConfirm={() => {
          setSignOutConfirmOpen(false);
          props.onSignOut?.();
        }}
      />
    </DropdownMenu>
  );
}

function SidebarAccountSubMenu(props: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  items: Array<{
    value: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
  }>;
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  const Icon = props.icon;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={sidebarAccountSubTriggerClass}>
        <Icon className="size-3.5 justify-self-center" />
        <span className="min-w-0 truncate">{props.label}</span>
        <ChevronRight className="size-3 justify-self-center text-muted-foreground" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        sideOffset={8}
        alignOffset={0}
        className="w-48 rounded-lg border-sidebar-border/70 bg-dls-surface p-1.5"
      >
        {props.items.map((item) => {
          const ItemIcon = item.icon;
          const selected = item.value === props.selectedValue;
          return (
            <DropdownMenuItem
              key={item.value}
              onClick={() => props.onSelect(item.value)}
              className={cn(
                sidebarAccountMenuGridClass,
                selected ? "!bg-dls-decision-soft !text-dls-accent" : "",
              )}
            >
              {ItemIcon ? (
                <ItemIcon className="size-3.5 justify-self-center" />
              ) : (
                <span aria-hidden="true" />
              )}
              <span className="min-w-0 truncate">{item.label}</span>
              {selected ? (
                <span className="size-1.5 justify-self-center rounded-full bg-dls-accent" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function SidebarAccountMenuItem(props: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect?: () => void;
  destructive?: boolean;
}) {
  const Icon = props.icon;

  if (props.destructive) {
    return (
      <DropdownMenuItem
        onClick={props.onSelect}
        className={cn(sidebarAccountMenuRowClass, "flex text-dls-status-danger hover:!bg-dls-status-danger-soft hover:text-dls-status-danger focus:!bg-dls-status-danger-soft focus:text-dls-status-danger data-highlighted:!bg-dls-status-danger-soft data-highlighted:!text-dls-status-danger")}
      >
        <Icon className="size-3.5 text-dls-status-danger" />
        <span className="flex-1 text-dls-status-danger">{props.label}</span>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      onClick={props.onSelect}
      className={sidebarAccountMenuGridClass}
    >
              <Icon className="size-3.5 justify-self-center" />
      <span className="min-w-0 truncate">{props.label}</span>
      {!props.destructive ? (
        <ChevronRight className="size-3 justify-self-center text-muted-foreground" />
      ) : null}
    </DropdownMenuItem>
  );
}

function SidebarBrand() {
  return (
    <div className="mb-4 flex h-12 items-center gap-2 px-2">
      <img src={resolvePublicAssetUrl("/on-my-agent-logo.png")} alt="" className="size-7 shrink-0" />
      <span className={appSidebarTextClass.brand}>
        {APP_NAME}
      </span>
    </div>
  );
}

function PrimaryMenuItem(props: {
  item: SidebarMenuConfig;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = props.item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={props.active}
        disabled={props.disabled}
        onClick={props.onClick}
        className="h-9 rounded-lg px-3.5 text-sm text-sidebar-foreground/80 data-[active=true]:bg-dls-rail-active data-[active=true]:text-sidebar-foreground dark:data-[active=true]:bg-dls-rail-active"
      >
        <Icon className="size-4 shrink-0" />
        <span className="shrink-0">{props.item.label}</span>
        {props.item.description ? (
          <span
            className={cn(
              "ml-auto truncate pl-3 text-xs font-normal",
              props.active
                ? "text-sidebar-foreground/45"
                : "text-sidebar-foreground/40",
            )}
          >
            {props.item.description}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SidebarSectionTrigger(props: {
  label: string;
  open: boolean;
  badge?: string;
  count?: number;
}) {
  const showCount = !props.open && props.count != null && props.count > 0;
  return (
    <CollapsibleTrigger className={appSidebarTextClass.groupLabel}>
      <ChevronRight
        className={cn("size-4 transition-transform", props.open && "rotate-90")}
      />
      <span>
        {props.label}
        {showCount ? ` (${props.count})` : null}
      </span>
      {props.badge ? (
        <StatusBadge size="tiny" className="bg-dls-surface text-sidebar-foreground/55 dark:bg-dls-surface">
          {props.badge}
        </StatusBadge>
      ) : null}
    </CollapsibleTrigger>
  );
}

type SessionListForWorkspaceProps = {
  group: WorkspaceSessionGroup;
  showInitialLoading?: boolean;
  previewCount: number;
  showMoreSessions: (workspaceId: string, totalRoots: number) => void;
};

function SessionListForWorkspace({
  group,
  showInitialLoading,
  previewCount,
  showMoreSessions,
}: SessionListForWorkspaceProps) {
  const ctx = useSidebarContext();
  const workspace = group.workspace;
  const sessions = React.useMemo(
    () =>
      getVisibleSidebarSessions(
        group.sessions,
        ctx.sessionStatusById,
        ctx.selectedSessionId,
      ),
    [ctx.selectedSessionId, ctx.sessionStatusById, group.sessions],
  );
  const tree = useSessionTree(sessions, ctx.sessionStatusById);
  const forcedExpandedSessionIds = React.useMemo(
    () =>
      new Set(
        ctx.selectedSessionId
          ? (tree.ancestorIdsBySessionId.get(ctx.selectedSessionId) ?? [])
          : [],
      ),
    [ctx.selectedSessionId, tree.ancestorIdsBySessionId],
  );
  const rootSessions = getRootSessions(sessions);
  const sessionRows = sessions
    .slice(0, previewCount)
    .map((session) => ({ session, depth: 0 }));
  const isRemoteWorkspace = isRemoteConnectionWorkspace(workspace);
  const connectionState: WorkspaceConnectionState = ctx
    .workspaceConnectionStateById[workspace.id] ?? {
    status: "idle",
    message: null,
  };
  const taskLoadError = getWorkspaceTaskLoadErrorDisplay(
    workspace,
    group.error,
  );
  const connectionIssueMessage =
    connectionState.status === "error"
      ? connectionState.message?.trim() || taskLoadError.message
      : group.error?.trim() || taskLoadError.message;
  const showRemoteConnectionIssue =
    (isRemoteWorkspace ||
      isRemoteConnectionErrorMessage(connectionIssueMessage)) &&
    Boolean(connectionIssueMessage) &&
    (connectionState.status === "error" || group.status === "error");
  const isConnectionActionBusy =
    ctx.connectingWorkspaceId === workspace.id ||
    connectionState.status === "connecting";
  const canRecover = isRemoteWorkspace && connectionState.status === "error";
  const remainingRootSessions = Math.max(0, rootSessions.length - previewCount);
  const showMoreLabel =
    remainingRootSessions > 0
      ? t("workspace_list.show_more", {
          count: Math.min(MAX_SESSIONS_PREVIEW, remainingRootSessions),
        })
      : t("workspace_list.show_more_fallback");

  return (
    <SidebarGroup className="px-0">
      <SidebarGroupContent>
        <SidebarMenuSub className="mx-0 border-l-0 px-0">
          {showRemoteConnectionIssue ? (
            <RemoteConnectionIssueCard
              message={connectionIssueMessage}
              tone={taskLoadError.tone}
              canRecover={canRecover}
              busy={isConnectionActionBusy}
              onRecover={() => {
                void Promise.resolve(ctx.onRecoverWorkspace(workspace.id));
              }}
              onTest={() => {
                void Promise.resolve(
                  ctx.onTestWorkspaceConnection(workspace.id),
                );
              }}
              onEdit={() => {
                ctx.onEditWorkspaceConnection(workspace.id);
              }}
            />
          ) : showInitialLoading ||
            (group.status === "loading" && group.sessions.length === 0) ? (
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                aria-disabled
                className="h-9 text-xs text-muted-foreground"
              >
                <span className="truncate">{t("workspace.loading_tasks")}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ) : sessions.length > 0 ? (
            <>
              {sessionRows.map((row) => (
                <SessionMenuItem
                  key={`${workspace.id}:${row.session.id}`}
                  session={row.session}
                  depth={row.depth}
                  tree={tree}
                  workspaceId={workspace.id}
                  forcedExpandedSessionIds={forcedExpandedSessionIds}
                />
              ))}
              {rootSessions.length > previewCount ? (
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    className="h-9 text-xs text-muted-foreground"
                    onClick={() =>
                      showMoreSessions(workspace.id, rootSessions.length)
                    }
                  >
                    <span className="truncate">{showMoreLabel}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ) : null}
            </>
          ) : group.status === "error" ? (
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                aria-disabled
                className={cn(
                  "h-9 text-xs",
                  taskLoadError.tone === "offline"
                    ? appSidebarStateClass.activeText
                    : "text-destructive",
                )}
              >
                <span className="truncate">{taskLoadError.message}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ) : null}
        </SidebarMenuSub>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

type SessionMenuItemProps = {
  session: SessionListItem;
  depth: number;
  tree: SessionTreeState;
  workspaceId: string;
  forcedExpandedSessionIds: Set<string>;
  showChildren?: boolean;
};

function SessionMenuItem({
  session,
  tree,
  workspaceId,
  forcedExpandedSessionIds,
  depth,
  showChildren = false,
}: SessionMenuItemProps) {
  const ctx = useSidebarContext();
  // Session highlight must be mutually exclusive with primary-menu
  // highlight (agents/plugins/scheduledTasks/channels) and with any
  // future "team" menu entries that also drive `activeView` away from
  // "chat". The URL-derived `selectedSessionId` alone is not enough —
  // clicking a primary menu does not clear the URL — so we gate on
  // `activeView === "chat"` here.
  const isSelected =
    ctx.activeView === "chat" && ctx.selectedSessionId === session.id;
  const displayTitle = getDisplaySessionTitle(session.title);
  const hasChildren =
    showChildren && (tree.descendantCountBySessionId.get(session.id) ?? 0) > 0;
  const isExpanded =
    ctx.expandedSessionIds.has(session.id) ||
    forcedExpandedSessionIds.has(session.id);
  const sessionActivityStatus = ctx.sessionStatusById?.[session.id];
  const isSessionActive = tree.activeIds.has(session.id);
  const isSessionStreaming =
    tree.streamingIds.has(session.id) ||
    isStreamingSessionStatus(sessionActivityStatus);

  const openSession = () => {
    ctx.onOpenSession(workspaceId, session.id);
  };

  const prefetchSession = () => {
    if (workspaceId !== ctx.selectedWorkspaceId) {
      return;
    }

    ctx.onPrefetchSession?.(workspaceId, session.id);
  };

  if (hasChildren) {
    return (
      <Collapsible
        open={isExpanded}
        onOpenChange={() => ctx.toggleSessionExpanded(session.id)}
        className="group/session-collapsible"
      >
        <SidebarMenuSubItem>
          <SessionContextMenu sessionId={session.id}>
            <CollapsibleTrigger
              render={
                <SidebarMenuSubButton
                  className={cn("relative", depth > 0 && "ps-13")}
                  isActive={isSelected}
                  onClick={openSession}
                  onPointerEnter={prefetchSession}
                  onFocus={prefetchSession}
                >
                  <SessionStatusIndicator
                    status={sessionActivityStatus}
                    isStreaming={isSessionStreaming}
                    isActive={isSessionActive}
                  />
                  <span
                    className="min-w-0 flex-1 truncate transition-[padding] duration-75 group-hover/menu-sub-item:pe-12 group-has-data-popup-open/menu-sub-item:pe-12 pe-4"
                    title={displayTitle}
                  >
                    {displayTitle}
                  </span>
                  <span className="flex items-center justify-center size-6 absolute right-2 top-1/2 -translate-y-1/2">
                    <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-data-open/session-collapsible:rotate-90 hover:text-foreground" />
                  </span>
                </SidebarMenuSubButton>
              }
            />
          </SessionContextMenu>
          <SessionActions
            sessionId={session.id}
            className="absolute right-9 top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-sub-item:opacity-100 data-popup-open:opacity-100"
          />
        </SidebarMenuSubItem>
      </Collapsible>
    );
  }

  return (
    <SidebarMenuSubItem>
      <SessionContextMenu sessionId={session.id}>
        <SidebarMenuSubButton
          isActive={isSelected}
          onClick={openSession}
          onPointerEnter={prefetchSession}
          onFocus={prefetchSession}
          className={cn(
            "transition-[padding] duration-75 group-hover/menu-sub-item:pe-8 group-has-data-popup-open/menu-sub-item:pe-8",
            depth > 0 && "ps-13",
          )}
        >
          <SessionStatusIndicator
            status={sessionActivityStatus}
            isStreaming={isSessionStreaming}
            isActive={isSessionActive}
          />
          <span className="truncate" title={displayTitle}>
            {displayTitle}
          </span>
        </SidebarMenuSubButton>
      </SessionContextMenu>
      <SessionActions
        sessionId={session.id}
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-sub-item:opacity-100 data-popup-open:opacity-100"
      />
    </SidebarMenuSubItem>
  );
}
