/** @jsxImportSource react */
import { useEffect, useRef } from "react";

import { desktopBridge } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";
import { useExpertUnreadStore } from "../domains/session";
import { useLocal } from "../kernel/local-provider";

/**
 * Pushes unread expert count to Dock (mac) / taskbar badge (win) when enabled.
 *
 * Count = number of experts (or pure-assistant scopes) with unread replies —
 * not summed assistant-turn counts (those accumulate and are not true
 * per-message unread). Server has no message-level read cursor.
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
      push(useExpertUnreadStore.getState().getTotalUnreadAgentCount());
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
