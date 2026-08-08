/** @jsxImportSource react */
import { useEffect, useRef } from "react";

import { t } from "@/i18n";
import { listAllAutomationOwnedSessionIds } from "../domains/messaging";
import {
  buildAgentReadyNotificationBody,
  shouldNotifyAgentReadyTransition,
  shouldSuppressAgentReadyForOwner,
  type AgentActivityPhase,
} from "../domains/shell-feedback";
import { useSessionActivityStore } from "../domains/session";
import { useLocal } from "../kernel/local-provider";
import { usePlatform } from "../kernel/platform";

/**
 * Composes session activity + preferences in the shell layer so domains stay
 * decoupled. Opt-in via LocalPreferences.desktopNotifyOnAgentReady (default false).
 *
 * Completion owner: automation-owned sessions skip interactive Agent-ready
 * alerts (automation has its own desktop notifier).
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
      // Lazy: only load ownership when at least one session would notify.
      let automationOwnedSessionIds: ReadonlySet<string> | null = null;
      const ownedIds = () => {
        automationOwnedSessionIds ??= listAllAutomationOwnedSessionIds();
        return automationOwnedSessionIds;
      };

      for (const [workspaceId, sessions] of Object.entries(nextMap)) {
        const prevSessions = previousMap[workspaceId] ?? {};
        for (const [sessionId, status] of Object.entries(sessions)) {
          const previous = prevSessions[sessionId];
          // Cheap phase gate before ownership lookup / notify.
          if (!shouldNotifyAgentReadyTransition(previous, status)) continue;
          if (
            shouldSuppressAgentReadyForOwner({
              sessionId,
              automationOwnedSessionIds: ownedIds(),
            })
          ) {
            continue;
          }

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
            playAgentReadyBeep();
          }
        }
      }

      previousStatusesRef.current = nextMap;
    });
  }, []);

  return null;
}

function playAgentReadyBeep(): void {
  try {
    const legacyCtor = Reflect.get(window, "webkitAudioContext");
    const Ctx: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : typeof legacyCtor === "function"
          ? (legacyCtor as typeof AudioContext)
          : undefined;
    if (!Ctx) return;
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
  } catch {
    // ignore audio failures
  }
}
