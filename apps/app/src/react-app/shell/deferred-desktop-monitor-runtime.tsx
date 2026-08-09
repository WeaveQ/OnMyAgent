/** @jsxImportSource react */
import { AgentReadyDesktopNotificationMonitor } from "./agent-ready-desktop-notification-monitor";
import { AutomationRunDesktopNotificationMonitor } from "./automation-run-desktop-notification-monitor";
import { DockUnreadBadgeMonitor } from "./dock-unread-badge-monitor";
import { SystemPrefsRuntime } from "./system-prefs-runtime";
import { UpdateAvailableNoticeMonitor } from "./update-available-notice-monitor";

/**
 * Desktop-only observers that are useful after boot but irrelevant to the
 * first renderer frame. Keeping their imports behind one lazy boundary avoids
 * pulling automation/session notification graphs into the bootstrap chunk.
 */
export function DeferredDesktopMonitorRuntime() {
  return (
    <>
      <SystemPrefsRuntime />
      <AgentReadyDesktopNotificationMonitor />
      <AutomationRunDesktopNotificationMonitor />
      <DockUnreadBadgeMonitor />
      <UpdateAvailableNoticeMonitor />
    </>
  );
}
