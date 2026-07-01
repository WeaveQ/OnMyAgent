/** @jsxImportSource react */
import * as React from "react";
import type { WorkspaceConnectionState } from "../../../../app/types";
import type { SidebarPrimaryView } from "./app-sidebar";

export type SidebarContextValue = {
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  /**
   * Which top-level sidebar entry is currently active (one of the 5 primary
   * menu items, or "chat" when a session is open). Used by list item
   * components to decide whether they should render as "selected". Keeping
   * this in context is what enables proper mutual exclusion between
   * primary-menu items, sessions, and future team entries.
   */
  activeView: SidebarPrimaryView;
  developerMode: boolean;
  showSessionActions?: boolean;
  sessionStatusById?: Record<string, string>;
  newTaskDisabled: boolean;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  onSelectWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onOpenRenameSession?: (sessionId: string) => void;
  onOpenDeleteSession?: (sessionId: string) => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onShareWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  expandWorkspace: (workspaceId: string) => void;
  toggleWorkspaceExpanded: (workspaceId: string) => void;
  toggleSessionExpanded: (sessionId: string) => void;
  expandedWorkspaceIds: Set<string>;
  expandedSessionIds: Set<string>;
};

export const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebarContext() {
  const context = React.use(SidebarContext);
  if (!context) throw new Error("useSidebarContext must be used within SidebarProvider");
  return context;
}
