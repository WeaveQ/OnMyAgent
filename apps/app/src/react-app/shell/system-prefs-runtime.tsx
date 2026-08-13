/** @jsxImportSource react */
/**
 * Applies desktop system prefs at runtime:
 * - launchAtLogin → OS login item (boot + when pref changes)
 * - keepSystemAwake → main-owned powerSaveBlocker aggregate while work is active
 * - menuBarStatusItem → menu-bar / system-tray show/hide (macOS + Windows)
 *
 * Settings UI only writes LocalPreferences; this component is the single
 * owner of the corresponding Electron IPC.
 */
import { useEffect, useRef } from "react";

import { desktopBridge } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";
import { useSessionActivityStore } from "../domains/session";
import { useLocal } from "../kernel/local-provider";

/** True while an agent turn is active (not idle/error terminal). */
function anySessionBusy(
  statusesByWorkspaceId: Record<string, Record<string, string>>,
): boolean {
  for (const sessions of Object.values(statusesByWorkspaceId)) {
    for (const status of Object.values(sessions ?? {})) {
      if (
        status === "thinking" ||
        status === "responding" ||
        status === "retrying" ||
        status === "compacting" ||
        status === "waiting"
      ) {
        return true;
      }
    }
  }
  return false;
}

export function SystemPrefsRuntime() {
  const local = useLocal();
  const launchAtLogin = local.prefs.launchAtLogin !== false;
  const keepSystemAwake = local.prefs.keepSystemAwake === true;
  const menuBarStatusItem = local.prefs.menuBarStatusItem !== false;

  const lastLaunchRef = useRef<boolean | null>(null);
  const lastAwakeRef = useRef<string | null>(null);
  const lastStatusItemRef = useRef<boolean | null>(null);

  // Sync login item with prefs (boot + toggles).
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (lastLaunchRef.current === launchAtLogin) return;
    lastLaunchRef.current = launchAtLogin;
    void desktopBridge.setLaunchAtLogin(launchAtLogin).catch(() => undefined);
  }, [launchAtLogin]);

  // Menu-bar status item (tray) visibility — default on; desktop only.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (lastStatusItemRef.current === menuBarStatusItem) return;
    lastStatusItemRef.current = menuBarStatusItem;
    void desktopBridge
      .setStatusItemVisible(menuBarStatusItem)
      .catch(() => undefined);
  }, [menuBarStatusItem]);

  // Keep-awake: publish both the preference and interactive activity. Electron
  // main combines this with durable Task Center activity, so a renderer reload
  // cannot release the blocker underneath a long-running task.
  useEffect(() => {
    if (!isDesktopRuntime()) return;

    const applyAwake = (interactiveBusy: boolean) => {
      const identity = `${keepSystemAwake}:${interactiveBusy}`;
      if (lastAwakeRef.current === identity) return;
      lastAwakeRef.current = identity;
      void desktopBridge
        .setKeepSystemAwake(keepSystemAwake, interactiveBusy)
        .catch(() => undefined);
    };

    if (!keepSystemAwake) {
      applyAwake(false);
      return;
    }

    const recompute = () => {
      const busy = anySessionBusy(
        useSessionActivityStore.getState().statusesByWorkspaceId as Record<
          string,
          Record<string, string>
        >,
      );
      applyAwake(busy);
    };

    recompute();
    return useSessionActivityStore.subscribe(() => recompute());
  }, [keepSystemAwake]);

  return null;
}
