/**
 * Session-route background prewarm: provider catalog + agent-management core.
 * Kept out of render.tsx so the host stays under the file-size baseline.
 */
import { useEffect } from "react";

import type { Client } from "../../../app/types";
import { prewarmAgentManagementCore } from "../../domains/local-agents";
import { prewarmWorkspaceProviders } from "../../domains/settings";

export function useSessionRoutePrewarm(input: {
  opencodeClient: Client | null | undefined;
  opencodeBaseUrl: string | null | undefined;
  sessionWorkspaceRoot: string | null | undefined;
}): void {
  const { opencodeClient, opencodeBaseUrl, sessionWorkspaceRoot } = input;

  // Warm provider.list + OpenCode inventory while the user is on the session
  // surface so the first Settings → Models open is cache-hit.
  useEffect(() => {
    if (!opencodeClient) return;
    let cancelled = false;
    void prewarmWorkspaceProviders({
      client: opencodeClient,
      baseUrl: opencodeBaseUrl,
      directory: sessionWorkspaceRoot || undefined,
      workspaceRoot: sessionWorkspaceRoot || undefined,
    }).catch((error) => {
      if (!cancelled) {
        console.warn("[session-route] providers prewarm failed", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [opencodeBaseUrl, opencodeClient, sessionWorkspaceRoot]);

  // Prefetch 管理 (Agent Management) core fleet after first paint so opening
  // the Management sidebar hits the shared snapshot cache.
  useEffect(() => {
    const root = sessionWorkspaceRoot?.trim();
    if (!root) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void prewarmAgentManagementCore(root).catch((error) => {
        if (!cancelled) {
          console.warn("[session-route] agent-management prewarm failed", error);
        }
      });
    };
    const win = window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout?: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      const idleId = win.requestIdleCallback(run, { timeout: 2500 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(idleId);
      };
    }
    const timer = window.setTimeout(run, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessionWorkspaceRoot]);
}
