/** @jsxImportSource react */
/**
 * Unified keymap dispatcher — single window keydown path that:
 * 1. Reads LocalPreferences.keymapOverrides
 * 2. Matches against DEFAULT_KEYMAP_ACTIONS (platform-aware)
 * 3. Dispatches product actions (settings, sidebar, new task, search, appshot)
 *
 * Composer send/newline stay in the editor (uses same match helpers + prefs)
 * so IME / Lexical priorities are preserved.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { desktopBridge } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";
import { useLocal } from "../kernel/local-provider";
import {
  clearPressedCodes,
  detectKeymapPlatform,
  matchKeymapAction,
  matchSpecialAppSnapshot,
  noteKeyDownCode,
  noteKeyUpCode,
  resolveAccelerator,
  shouldIgnoreForTarget,
  type KeymapActionId,
} from "../domains/settings";
import { useUiStateStore } from "./ui-state-store";

export const KEYMAP_EVENT_NEW_TASK = "onmyagent:keymap:new-task";
export const KEYMAP_EVENT_SEARCH_IN_TASK = "onmyagent:keymap:search-in-task";
export const KEYMAP_EVENT_APP_SNAPSHOT = "onmyagent:keymap:app-snapshot";

function pageModeFromPathname(pathname: string): "assistant" | "expert" {
  return pathname.includes("/assistant") ? "assistant" : "expert";
}

function openSettingsNavigate(
  navigate: ReturnType<typeof useNavigate>,
  location: ReturnType<typeof useLocation>,
) {
  if (location.pathname.includes("/settings")) {
    navigate(
      location.pathname.includes("/workspace/")
        ? location.pathname.replace(/\/settings\/.*$/, "/settings/general")
        : "/settings/general",
      { replace: true, state: location.state },
    );
    return;
  }
  const workspaceMatch = location.pathname.match(/^\/workspace\/([^/]+)\//);
  const workspaceId = workspaceMatch
    ? decodeURIComponent(workspaceMatch[1])
    : "";
  const sessionMatch = location.pathname.match(
    /\/(?:assistant|session)\/([^/]+)/,
  );
  const sessionId = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null;
  const target = workspaceId
    ? `/workspace/${encodeURIComponent(workspaceId)}/settings/general`
    : "/settings/general";
  navigate(target, {
    state: {
      workspaceId,
      sessionId,
      pageMode: pageModeFromPathname(location.pathname),
      returnTo: `${location.pathname}${location.search}`,
    },
  });
}

function dispatchWindowEvent(name: string) {
  window.dispatchEvent(new CustomEvent(name));
}

async function runAppSnapshot() {
  if (!isDesktopRuntime()) return;
  try {
    await desktopBridge.captureComputerUseAppshot();
  } catch (error) {
    console.warn("[keymap] app snapshot failed", error);
  }
}

/**
 * Mount once near app root (inside Router + LocalProvider).
 */
export function KeymapDispatcher() {
  const local = useLocal();
  const navigate = useNavigate();
  const location = useLocation();
  const toggleSidebar = useUiStateStore((s) => s.toggleSidebar);

  const overridesRef = useRef(local.prefs.keymapOverrides ?? {});
  overridesRef.current = local.prefs.keymapOverrides ?? {};
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const locationRef = useRef(location);
  locationRef.current = location;
  const toggleSidebarRef = useRef(toggleSidebar);
  toggleSidebarRef.current = toggleSidebar;

  // Push menu accelerators whenever overrides change.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void desktopBridge
      .setKeymapAcceleratorOverrides(overridesRef.current)
      .catch(() => undefined);
  }, [local.prefs.keymapOverrides]);

  // Register app-snapshot globalShortcut when it's a normal accelerator (not dual-mod).
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const platform = detectKeymapPlatform();
    const accel = resolveAccelerator(
      "appSnapshot",
      local.prefs.keymapOverrides,
      platform,
    );
    if (
      !accel ||
      accel === "double-command" ||
      accel === "double-control"
    ) {
      void desktopBridge.unregisterAppSnapshotHotkey().catch(() => undefined);
      return;
    }
    // Electron uses first binding only for globalShortcut.
    const first = accel.split("|")[0]?.trim();
    if (!first) return;
    void desktopBridge
      .registerAppSnapshotHotkey(first)
      .catch(() => undefined);
    return () => {
      void desktopBridge.unregisterAppSnapshotHotkey().catch(() => undefined);
    };
  }, [local.prefs.keymapOverrides, local.prefs.appSnapshotHotkey]);

  useEffect(() => {
    const platform = detectKeymapPlatform();

    const runAction = (action: KeymapActionId, event: KeyboardEvent) => {
      if (shouldIgnoreForTarget(action, event.target)) return false;
      // Composer-owned actions: let Lexical handle (dispatcher must not steal).
      if (action === "sendMessage" || action === "insertNewline") return false;

      switch (action) {
        case "openSettings":
          event.preventDefault();
          openSettingsNavigate(navigateRef.current, locationRef.current);
          return true;
        case "toggleSidebar":
          event.preventDefault();
          toggleSidebarRef.current();
          return true;
        case "newTask":
          event.preventDefault();
          dispatchWindowEvent(KEYMAP_EVENT_NEW_TASK);
          return true;
        case "searchInCurrentTask":
          event.preventDefault();
          dispatchWindowEvent(KEYMAP_EVENT_SEARCH_IN_TASK);
          return true;
        case "appSnapshot":
          event.preventDefault();
          void runAppSnapshot();
          dispatchWindowEvent(KEYMAP_EVENT_APP_SNAPSHOT);
          return true;
        default:
          return false;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code) noteKeyDownCode(event.code);

      // Dual-modifier app snapshot (⌘+⌘ / Ctrl+Ctrl)
      const snapAccel = resolveAccelerator(
        "appSnapshot",
        overridesRef.current,
        platform,
      );
      if (
        matchSpecialAppSnapshot(platform, snapAccel) &&
        (event.code === "MetaLeft" ||
          event.code === "MetaRight" ||
          event.code === "ControlLeft" ||
          event.code === "ControlRight")
      ) {
        event.preventDefault();
        void runAppSnapshot();
        dispatchWindowEvent(KEYMAP_EVENT_APP_SNAPSHOT);
        return;
      }

      // Ignore pure modifier keys for normal matching
      if (
        event.key === "Meta" ||
        event.key === "Control" ||
        event.key === "Shift" ||
        event.key === "Alt"
      ) {
        return;
      }

      const action = matchKeymapAction(
        event,
        overridesRef.current,
        platform,
      );
      if (!action) return;
      runAction(action, event);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code) noteKeyUpCode(event.code);
    };

    const onBlur = () => clearPressedCodes();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      clearPressedCodes();
    };
  }, []);

  // Native menu / menu-bar status-item events (Electron main → preload → window).
  useEffect(() => {
    const openSettings = () =>
      openSettingsNavigate(navigateRef.current, locationRef.current);
    const onNewTask = () => dispatchWindowEvent(KEYMAP_EVENT_NEW_TASK);
    const onDesktopPermissions = () => {
      // Prefer opening the OS permission helper; fall back is no-op if not desktop.
      if (!isDesktopRuntime()) return;
      void desktopBridge.openComputerUsePermissionSetup().catch((error) => {
        console.warn("[native-menu] desktop permissions failed", error);
      });
    };
    window.addEventListener("onmyagent:native-menu:open-settings", openSettings);
    window.addEventListener(
      "onmyagent:native-menu:toggle-sidebar",
      toggleSidebarRef.current,
    );
    window.addEventListener("onmyagent:native-menu:new-task", onNewTask);
    window.addEventListener(
      "onmyagent:native-menu:desktop-permissions",
      onDesktopPermissions,
    );
    return () => {
      window.removeEventListener(
        "onmyagent:native-menu:open-settings",
        openSettings,
      );
      window.removeEventListener(
        "onmyagent:native-menu:toggle-sidebar",
        toggleSidebarRef.current,
      );
      window.removeEventListener("onmyagent:native-menu:new-task", onNewTask);
      window.removeEventListener(
        "onmyagent:native-menu:desktop-permissions",
        onDesktopPermissions,
      );
    };
  }, []);

  return null;
}
