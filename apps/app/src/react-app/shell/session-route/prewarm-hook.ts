/**
 * Session-route background prewarm: provider catalog + agent-management core.
 * Kept out of render.tsx so the host stays under the file-size baseline.
 *
 * Both paths are idle-deferred so first paint can finish listSessions and the
 * selected-session snapshot without competing for OpenCode / IPC.
 */
import { useEffect } from "react";

import type { Client } from "../../../app/types";
import { prewarmAgentManagementCore } from "../../domains/local-agents";
import { prewarmWorkspaceProviders } from "../../domains/settings";
import { scheduleIdleWork } from "./prewarm-schedule";

export function useSessionRoutePrewarm(input: {
  opencodeClient: Client | null | undefined;
  opencodeBaseUrl: string | null | undefined;
  sessionWorkspaceRoot: string | null | undefined;
}): void {
  const { opencodeClient, opencodeBaseUrl, sessionWorkspaceRoot } = input;

  // Warm OpenCode inventory after idle. provider.list waits for the model picker.
  useEffect(() => {
    if (!opencodeClient) return;
    let cancelled = false;
    const scheduled = scheduleIdleWork({
      run: () => {
        if (cancelled) return;
        void prewarmWorkspaceProviders({
          client: opencodeClient,
          baseUrl: opencodeBaseUrl,
          directory: sessionWorkspaceRoot || undefined,
          workspaceRoot: sessionWorkspaceRoot || undefined,
          // Do not double-hit OpenCode provider.list on cold first paint —
          // model-catalog already loads it for the composer.
          inventoryOnly: true,
        }).catch((error) => {
          if (!cancelled) {
            console.warn("[session-route] providers prewarm failed", error);
          }
        });
      },
    });
    return () => {
      cancelled = true;
      scheduled.cancel();
    };
  }, [opencodeBaseUrl, opencodeClient, sessionWorkspaceRoot]);

  // Prefetch 管理 (Agent Management) core fleet after first paint so opening
  // the Management sidebar hits the shared snapshot cache.
  useEffect(() => {
    const root = sessionWorkspaceRoot?.trim();
    if (!root) return;
    let cancelled = false;
    const scheduled = scheduleIdleWork({
      run: () => {
        if (cancelled) return;
        void prewarmAgentManagementCore(root).catch((error) => {
          if (!cancelled) {
            console.warn(
              "[session-route] agent-management prewarm failed",
              error,
            );
          }
        });
      },
    });
    return () => {
      cancelled = true;
      scheduled.cancel();
    };
  }, [sessionWorkspaceRoot]);
}
