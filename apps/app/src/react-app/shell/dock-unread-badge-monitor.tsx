/** @jsxImportSource react */
import { useEffect, useRef } from "react";

import { desktopBridge } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";
import { useExpertUnreadStore } from "../domains/session";
import { useLocal } from "../kernel/local-provider";

function totalUnreadCount(
  byWorkspace: Record<string, Record<string, { unreadCount?: number }>>,
): number {
  let total = 0;
  for (const agents of Object.values(byWorkspace)) {
    for (const record of Object.values(agents ?? {})) {
      const n = record?.unreadCount ?? 0;
      if (typeof n === "number" && n > 0) total += n;
    }
  }
  return total;
}

/**
 * Pushes expert unread totals to Dock (mac) / taskbar badge (win) when enabled.
 */
export function DockUnreadBadgeMonitor() {
  const local = useLocal();
  const enabledRef = useRef(local.prefs.dockUnreadBadge !== false);
  enabledRef.current = local.prefs.dockUnreadBadge !== false;
  const lastSentRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    const push = (count: number) => {
      if (lastSentRef.current === count) return;
      lastSentRef.current = count;
      void desktopBridge.setDockUnreadBadge(count).catch(() => undefined);
    };

    const apply = () => {
      if (!enabledRef.current) {
        push(0);
        return;
      }
      const state = useExpertUnreadStore.getState();
      push(totalUnreadCount(state.byWorkspace));
    };

    apply();
    return useExpertUnreadStore.subscribe(() => apply());
  }, [local.prefs.dockUnreadBadge]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (local.prefs.dockUnreadBadge === false) {
      void desktopBridge.setDockUnreadBadge(0).catch(() => undefined);
      lastSentRef.current = 0;
    }
  }, [local.prefs.dockUnreadBadge]);

  return null;
}
