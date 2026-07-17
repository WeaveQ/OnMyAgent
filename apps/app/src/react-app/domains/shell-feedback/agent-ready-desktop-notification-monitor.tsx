/** @jsxImportSource react */
import { useEffect, useRef } from "react";

import { t } from "@/i18n";
import { useLocal } from "../../kernel/local-provider";
import { usePlatform } from "../../kernel/platform";
import {
  useSessionActivityStore,
  type SessionActivityStatus,
} from "../session/status/session-activity-store";
import {
  buildAgentReadyNotificationBody,
  shouldNotifyAgentReadyTransition,
} from "./agent-ready-desktop-notifications";

/**
 * Opt-in desktop alerts when an agent turn becomes idle and the window is
 * not focused. Preference lives in LocalPreferences.desktopNotifyOnAgentReady
 * (default false).
 */
export function AgentReadyDesktopNotificationMonitor() {
  const local = useLocal();
  const platform = usePlatform();
  const enabledRef = useRef(local.prefs.desktopNotifyOnAgentReady === true);
  enabledRef.current = local.prefs.desktopNotifyOnAgentReady === true;
  const platformRef = useRef(platform);
  platformRef.current = platform;

  const previousStatusesRef = useRef<
    Record<string, Record<string, SessionActivityStatus>>
  >({});
  /** Dedup: sessionId → last notified at */
  const lastNotifiedAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return useSessionActivityStore.subscribe((state) => {
      if (!enabledRef.current) {
        previousStatusesRef.current = state.statusesByWorkspaceId;
        return;
      }

      const previousMap = previousStatusesRef.current;
      const nextMap = state.statusesByWorkspaceId;

      for (const [workspaceId, sessions] of Object.entries(nextMap)) {
        const prevSessions = previousMap[workspaceId] ?? {};
        for (const [sessionId, status] of Object.entries(sessions)) {
          const previous = prevSessions[sessionId];
          if (!shouldNotifyAgentReadyTransition(previous, status)) continue;

          const now = Date.now();
          const last = lastNotifiedAtRef.current[sessionId] ?? 0;
          if (now - last < 4_000) continue;
          lastNotifiedAtRef.current[sessionId] = now;

          const title = t("settings.agent_ready_notification_title");
          const body = buildAgentReadyNotificationBody({
            sessionTitle: sessionId,
            userSnippet: null,
            assistantSnippet: null,
            fallbackBody: t("settings.agent_ready_notification_body", {
              title: sessionId.slice(0, 12),
            }),
          });
          void platformRef.current.notify(title, body);
        }
      }

      previousStatusesRef.current = nextMap;
    });
  }, []);

  return null;
}
