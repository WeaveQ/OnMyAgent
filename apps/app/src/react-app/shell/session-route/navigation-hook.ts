/** Session route navigation + auth chrome (URL params, page mode, intent). */
import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { clearLocalAuthUser, readLocalAuthUser } from "../../../app/lib/local-auth";
import type { PageMode } from "../../domains/session";
import { useLocal } from "../../kernel/local-provider";
import { resolveWorkspaceSessionRoute } from "./control";
import {
  clearSessionAgentManagementIntentState,
  readSessionAgentManagementIntent,
} from "./intent";
import {
  localUserToSidebarAccount,
  type SessionSidebarAccount,
} from "./model";

export function useSessionRouteNavigation() {
  const navigate = useNavigate();
  const local = useLocal();
  const [sidebarAccount, setSidebarAccount] =
    useState<SessionSidebarAccount | null>(() =>
      localUserToSidebarAccount(readLocalAuthUser()),
    );
  const localUserSignedIn = sidebarAccount !== null;
  const params = useParams<{ workspaceId?: string; sessionId?: string }>();
  const location = useLocation();
  const routeWorkspaceId = params.workspaceId?.trim() || "";
  const selectedSessionId = params.sessionId?.trim() || null;
  const isAssistantMode = location.pathname.includes("/assistant");
  const pageMode: PageMode = isAssistantMode ? "assistant" : "expert";
  const agentManagementIntent = useMemo(
    () => readSessionAgentManagementIntent(location.state),
    [location.state],
  );
  const clearAgentManagementIntent = useCallback(
    (key: string) => {
      const current = readSessionAgentManagementIntent(location.state);
      if (!current || current.key !== key) return;
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: clearSessionAgentManagementIntentState(location.state),
      });
    },
    [location.hash, location.pathname, location.search, location.state, navigate],
  );
  const handleSignOut = useCallback(() => {
    clearLocalAuthUser();
    setSidebarAccount(null);
    local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: false }));
    navigate("/welcome", { replace: true });
  }, [local, navigate]);
  const navigateToWorkspaceSession = useCallback(
    (
      workspaceId: string,
      sessionId?: string | null,
      options?: { replace?: boolean },
    ) => {
      const route = resolveWorkspaceSessionRoute({
        assistantMode: isAssistantMode,
        sessionId,
        workspaceId,
      });
      navigate(route, options);
    },
    [navigate, isAssistantMode],
  );

  return {
    navigate,
    local,
    sidebarAccount,
    setSidebarAccount,
    localUserSignedIn,
    routeWorkspaceId,
    selectedSessionId,
    isAssistantMode,
    pageMode,
    agentManagementIntent,
    clearAgentManagementIntent,
    handleSignOut,
    navigateToWorkspaceSession,
    location,
  };
}
