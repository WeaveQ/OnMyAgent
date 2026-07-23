/** @jsxImportSource react */
import { useEffect, useRef } from "react";

import { t } from "@/i18n";
import {
  addAssistantSession,
  writeAssistantSessionCategory,
} from "../domains/agents";
import { syncAutomationSessionRecords } from "../domains/messaging";
import {
  buildAutomationRunNotificationCopy,
  collectAutomationRunNotifications,
  type AutomationRunNotifyCandidate,
} from "../domains/shell-feedback";
import { usePlatform } from "../kernel/platform";
import { loadSessionOnMyAgentConnectionState } from "./session-route/server-actions";
import { workspaceAssistantRoute } from "./workspace-routes";

const POLL_MS_IDLE = 15_000;
const POLL_MS_ACTIVE = 5_000;

/**
 * Polls workspace automations and shows an OS desktop notification when a
 * scheduled/manual run finishes (success or failed). Click opens the run
 * session in assistant mode.
 */
export function AutomationRunDesktopNotificationMonitor() {
  const platform = usePlatform();
  const platformRef = useRef(platform);
  platformRef.current = platform;

  const seenRef = useRef<Set<string>>(new Set());
  const seededWorkspacesRef = useRef<Set<string>>(new Set());
  const hasAnyRunningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    let timer: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = hasAnyRunningRef.current ? POLL_MS_ACTIVE : POLL_MS_IDLE;
      timer = window.setTimeout(() => {
        void tick();
      }, delay);
    };

    const emitNotification = (candidate: AutomationRunNotifyCandidate) => {
      if (candidate.sessionId) {
        addAssistantSession(candidate.sessionId);
        writeAssistantSessionCategory(
          candidate.sessionId,
          candidate.scene === "code" ? "code" : "office",
        );
      }

      const copy = buildAutomationRunNotificationCopy({
        title: candidate.title,
        status: candidate.status,
        labels: {
          successTitle: t("automation.desktop_notify_success_title"),
          failedTitle: t("automation.desktop_notify_failed_title"),
          successBody: (taskTitle) =>
            t("automation.desktop_notify_success_body", { title: taskTitle }),
          failedBody: (taskTitle) =>
            t("automation.desktop_notify_failed_body", { title: taskTitle }),
        },
      });

      const href = candidate.sessionId
        ? workspaceAssistantRoute(candidate.workspaceId, candidate.sessionId)
        : workspaceAssistantRoute(candidate.workspaceId);

      void platformRef.current.notify(copy.title, copy.body, href, {
        force: true,
      });
    };

    const tick = async () => {
      if (cancelled || busy) {
        scheduleNext();
        return;
      }
      busy = true;
      try {
        const connection = await loadSessionOnMyAgentConnectionState();
        if (cancelled || !connection.onmyagentClient) {
          hasAnyRunningRef.current = false;
          return;
        }

        let anyRunning = false;
        for (const workspace of connection.serverWorkspaces) {
          const workspaceId = workspace.id.trim();
          if (!workspaceId) continue;

          let items: Awaited<
            ReturnType<typeof connection.onmyagentClient.listAutomations>
          >["items"] = [];
          try {
            const listed = await connection.onmyagentClient.listAutomations(
              workspaceId,
            );
            items = listed.items;
          } catch {
            continue;
          }

          if (cancelled) return;

          syncAutomationSessionRecords(workspaceId, items);
          anyRunning =
            anyRunning || items.some((item) => item.running != null);

          const seedOnly = !seededWorkspacesRef.current.has(workspaceId);
          const { notifications, nextSeen } = collectAutomationRunNotifications(
            seenRef.current,
            workspaceId,
            items.map((item) => ({
              id: item.id,
              title: item.title,
              scene: item.scene,
              lastRun: item.lastRun
                ? {
                    status: item.lastRun.status,
                    ranAt: item.lastRun.ranAt,
                    ...(item.lastRun.sessionId
                      ? { sessionId: item.lastRun.sessionId }
                      : {}),
                  }
                : null,
            })),
            { seedOnly },
          );
          seenRef.current = nextSeen;
          seededWorkspacesRef.current.add(workspaceId);

          if (seedOnly) continue;
          for (const candidate of notifications) {
            emitNotification(candidate);
          }
        }

        hasAnyRunningRef.current = anyRunning;
      } catch {
        // Poll is best-effort; ignore transient connection errors.
      } finally {
        busy = false;
        scheduleNext();
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
