import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceSessionGroup } from "../../../../app/types";

import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
} from "./session-page-model";
import type { OnMyAgentPrimaryView } from "./session-page-sidebar-view-model";

export function useSessionPageAgentPanel(selectedSessionId: string | null) {
  const [activeSidebarView, setActiveSidebarView] =
    useState<OnMyAgentPrimaryView>("chat");
  const [agentSearch, setAgentSearch] = useState("");
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(
    AGENT_PANEL_DEFAULT_WIDTH,
  );
  const [agentsDialogOpen, setAgentsDialogOpen] = useState(false);

  useEffect(() => {
    if (selectedSessionId?.trim()) {
      setActiveSidebarView("chat");
    }
  }, [selectedSessionId]);

  const openSidebarView = useCallback((view: OnMyAgentPrimaryView) => {
    setActiveSidebarView(view);
    if (view === "chat") setAgentPanelCollapsed(false);
  }, []);

  const openChatView = useCallback(() => {
    setActiveSidebarView("chat");
  }, []);

  const isChatView = activeSidebarView === "chat";

  const openDevicesView = useCallback(() => {
    setActiveSidebarView("devices");
  }, []);

  const openBillingView = useCallback(() => {
    setActiveSidebarView("billing");
  }, []);

  const toggleAgentPanelCollapsed = useCallback(() => {
    setAgentPanelCollapsed((value) => !value);
  }, []);

  const expandAgentPanel = useCallback(() => {
    setAgentPanelCollapsed(false);
  }, []);

  const openAgentsDialog = useCallback(() => {
    setAgentsDialogOpen(true);
  }, []);

  const closeAgentsDialog = useCallback(() => {
    setAgentsDialogOpen(false);
  }, []);

  const resizeAgentPanelBy = useCallback((delta: number) => {
    setAgentPanelWidth((width) =>
      Math.min(
        AGENT_PANEL_MAX_WIDTH,
        Math.max(AGENT_PANEL_MIN_WIDTH, width + delta),
      ),
    );
  }, []);

  const startAgentPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = agentPanelWidth;
      const controller = new AbortController();

      const resize = (moveEvent: PointerEvent) => {
        const nextWidth = Math.min(
          AGENT_PANEL_MAX_WIDTH,
          Math.max(
            AGENT_PANEL_MIN_WIDTH,
            startWidth + moveEvent.clientX - startX,
          ),
        );
        setAgentPanelWidth(nextWidth);
      };
      const stop = () => controller.abort();

      window.addEventListener("pointermove", resize, {
        signal: controller.signal,
      });
      window.addEventListener("pointerup", stop, {
        once: true,
        signal: controller.signal,
      });
      window.addEventListener("pointercancel", stop, {
        once: true,
        signal: controller.signal,
      });
    },
    [agentPanelWidth],
  );

  return {
    activeSidebarView,
    isChatView,
    agentSearch,
    agentPanelCollapsed,
    agentPanelWidth,
    agentsDialogOpen,
    setAgentSearch,
    setAgentsDialogOpen,
    openSidebarView,
    openChatView,
    openDevicesView,
    openBillingView,
    toggleAgentPanelCollapsed,
    expandAgentPanel,
    openAgentsDialog,
    closeAgentsDialog,
    resizeAgentPanelBy,
    startAgentPanelResize,
  };
}

export function useOpenFirstSessionOnChatView(input: {
  isChatView: boolean;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  workspaceSessionGroups: WorkspaceSessionGroup[];
  onOpenSession: (workspaceId: string, sessionId: string) => void;
}) {
  const {
    isChatView,
    onOpenSession,
    selectedSessionId,
    selectedWorkspaceId,
    workspaceSessionGroups,
  } = input;

  useEffect(() => {
    if (!isChatView || selectedSessionId) return;
    const group = workspaceSessionGroups.find(
      (item) => item.workspace.id === selectedWorkspaceId,
    );
    const session = group?.sessions[0];
    if (!session) return;
    onOpenSession(selectedWorkspaceId, session.id);
  }, [isChatView, onOpenSession, selectedSessionId, selectedWorkspaceId, workspaceSessionGroups]);
}
