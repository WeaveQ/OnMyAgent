/** @jsxImportSource react */
import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useUiStateStore } from "./ui-state-store";

const NATIVE_MENU_OPEN_SETTINGS_EVENT = "onmyagent:native-menu:open-settings";
const NATIVE_MENU_TOGGLE_SIDEBAR_EVENT = "onmyagent:native-menu:toggle-sidebar";

function pageModeFromPathname(pathname: string): "assistant" | "expert" {
  return pathname.includes("/assistant") ? "assistant" : "expert";
}

export function AppMenuProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toggleSidebar = useUiStateStore((state) => state.toggleSidebar);

  useEffect(() => {
    const openSettings = () => {
      // Already on a settings route — keep state, just land on general if needed.
      if (location.pathname.includes("/settings")) {
        navigate(location.pathname.includes("/workspace/")
          ? location.pathname.replace(/\/settings\/.*$/, "/settings/general")
          : "/settings/general", {
          replace: true,
          state: location.state,
        });
        return;
      }
      const workspaceMatch = location.pathname.match(
        /^\/workspace\/([^/]+)\//,
      );
      const workspaceId = workspaceMatch
        ? decodeURIComponent(workspaceMatch[1])
        : "";
      const sessionMatch = location.pathname.match(
        /\/(?:assistant|session)\/([^/]+)/,
      );
      const sessionId = sessionMatch
        ? decodeURIComponent(sessionMatch[1])
        : null;
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
    };

    window.addEventListener(NATIVE_MENU_OPEN_SETTINGS_EVENT, openSettings);
    window.addEventListener(NATIVE_MENU_TOGGLE_SIDEBAR_EVENT, toggleSidebar);
    return () => {
      window.removeEventListener(NATIVE_MENU_OPEN_SETTINGS_EVENT, openSettings);
      window.removeEventListener(NATIVE_MENU_TOGGLE_SIDEBAR_EVENT, toggleSidebar);
    };
  }, [location.pathname, location.search, location.state, navigate, toggleSidebar]);

  return <>{children}</>;
}
