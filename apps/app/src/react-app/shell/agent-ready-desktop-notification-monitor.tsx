/** @jsxImportSource react */
import { useEffect, useRef } from "react";

import { t } from "@/i18n";
import {
  buildAgentReadyNotificationBody,
  shouldNotifyAgentReadyTransition,
  type AgentActivityPhase,
} from "../domains/shell-feedback";
import { useSessionActivityStore } from "../domains/session";
import { useLocal } from "../kernel/local-provider";
import { usePlatform } from "../kernel/platform";

/**
 * Composes session activity + preferences in the shell layer so domains stay
 * decoupled. Opt-in via LocalPreferences.desktopNotifyOnAgentReady (default false).
 */
export function AgentReadyDesktopNotificationMonitor() {
  const local = useLocal();
  const platform = usePlatform();
  const enabledRef = useRef(
    local.prefs.desktopNotificationsEnabled !== false &&
      local.prefs.desktopNotifyOnAgentReady === true,
  );
  enabledRef.current =
    local.prefs.desktopNotificationsEnabled !== false &&
    local.prefs.desktopNotifyOnAgentReady === true;
  const soundEnabledRef = useRef(local.prefs.soundNotifyOnAgentReady !== false);
  soundEnabledRef.current = local.prefs.soundNotifyOnAgentReady !== false;
  const platformRef = useRef(platform);
  platformRef.current = platform;

  const previousStatusesRef = useRef<
    Record<string, Record<string, AgentActivityPhase>>
  >({});
  /** Dedup: sessionId → last notified at */
  const lastNotifiedAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return useSessionActivityStore.subscribe((state) => {
      const nextMap = state.statusesByWorkspaceId as Record<
        string,
        Record<string, AgentActivityPhase>
      >;

      const wantNotify = enabledRef.current;
      const wantSound = soundEnabledRef.current;
      if (!wantNotify && !wantSound) {
        previousStatusesRef.current = nextMap;
        return;
      }

      const previousMap = previousStatusesRef.current;

      for (const [workspaceId, sessions] of Object.entries(nextMap)) {
        const prevSessions = previousMap[workspaceId] ?? {};
        for (const [sessionId, status] of Object.entries(sessions)) {
          const previous = prevSessions[sessionId];
          if (!shouldNotifyAgentReadyTransition(previous, status)) continue;

          const now = Date.now();
          const last = lastNotifiedAtRef.current[sessionId] ?? 0;
          if (now - last < 4_000) continue;
          lastNotifiedAtRef.current[sessionId] = now;

          if (wantNotify) {
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
          if (wantSound) {
            try {
              // Short system-style beep via Web Audio; no asset required for v1.
              const Ctx =
                window.AudioContext ||
                (window as unknown as { webkitAudioContext?: typeof AudioContext })
                  .webkitAudioContext;
              if (Ctx) {
                const ctx = new Ctx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.value = 880;
                gain.gain.value = 0.05;
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.12);
                void ctx.close().catch(() => undefined);
              }
            } catch {
              // ignore audio failures
            }
          }
        }
      }

      previousStatusesRef.current = nextMap;
    });
  }, []);

  return null;
}
