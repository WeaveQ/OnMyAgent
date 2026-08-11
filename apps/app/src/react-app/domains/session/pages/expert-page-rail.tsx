import { OnMyAgentRail, isAutomationRailView } from "../sidebar/session-chrome";
import { openAutomationRailPath } from "./open-automation-rail";
import type { ExpertPageRailViewProps } from "./expert-page-view-types";

export type ExpertPageRailProps = ExpertPageRailViewProps;

export function ExpertPageRail({
  account,
  selectedWorkspaceId,
  onNavigateToMode,
  onOpenAccountSettings,
  onOpenProfile,
  onSignOut,
  activeSidebarView,
  closeExpertCreation,
  closeExpertCreationThen,
  openRailView,
  navigate,
  setAgentPanelCollapsed,
}: ExpertPageRailProps) {
  return (
    <OnMyAgentRail
      activeView={
        isAutomationRailView(activeSidebarView) ? "automation" : activeSidebarView
      }
      account={account}
      onOpenView={(view) => {
        closeExpertCreation();
        if (view === "assistant") {
          onNavigateToMode("assistant");
          return;
        }
        if (isAutomationRailView(view)) {
          const path = openAutomationRailPath(selectedWorkspaceId);
          if (path) navigate(path);
          return;
        }
        openRailView(view);
        if (view === "chat") setAgentPanelCollapsed(false);
      }}
      onOpenAccountSettings={closeExpertCreationThen(onOpenAccountSettings)}
      onOpenProfile={closeExpertCreationThen(onOpenProfile)}
      onSignOut={onSignOut}
      onOpenDevices={closeExpertCreationThen(() => openRailView("devices"))}
      onOpenBilling={closeExpertCreationThen(() => openRailView("billing"))}
    />
  );
}
