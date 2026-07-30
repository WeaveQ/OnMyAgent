/** @jsxImportSource react */
/**
 * Applies desktop system prefs at runtime:
 * - launchAtLogin → OS login item (boot + when pref changes)
 * - keepSystemAwake → powerSaveBlocker only while any session is running
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

  const lastLaunchRef = useRef<boolean | null>(null);
  const lastAwakeRef = useRef<boolean | null>(null);

  // Sync login item with prefs (boot + toggles).
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (lastLaunchRef.current === launchAtLogin) return;
    lastLaunchRef.current = launchAtLogin;
    void desktopBridge.setLaunchAtLogin(launchAtLogin).catch(() => undefined);
  }, [launchAtLogin]);

  // Keep-awake: only while agent busy when pref enabled.
  useEffect(() => {
    if (!isDesktopRuntime()) return;

    const applyAwake = (want: boolean) => {
      if (lastAwakeRef.current === want) return;
      lastAwakeRef.current = want;
      void desktopBridge.setKeepSystemAwake(want).catch(() => undefined);
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
