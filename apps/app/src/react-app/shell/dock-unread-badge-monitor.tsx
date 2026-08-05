/** @jsxImportSource react */
import { useEffect } from "react";

import { desktopBridge } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";

/**
 * Clears Dock (mac) / taskbar (win) badge on boot.
 * Product decision: do not show unread count on the app icon.
 */
export function DockUnreadBadgeMonitor() {
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void desktopBridge.setDockUnreadBadge(0).catch(() => undefined);
  }, []);

  return null;
}
