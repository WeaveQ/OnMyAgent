/**
 * Settings-route providers prewarm — extracted from render.tsx for file-size.
 */
import { useEffect } from "react";

import type { Client } from "../../../app/types";
import { prewarmWorkspaceProviders } from "../../domains/settings";

export function useSettingsProvidersPrewarm(input: {
  opencodeClient: Client | null | undefined;
  opencodeBaseUrl: string | null | undefined;
  selectedWorkspaceRoot: string | null | undefined;
}): void {
  const { opencodeClient, opencodeBaseUrl, selectedWorkspaceRoot } = input;

  // Prefetch Models tab data as soon as the settings workspace client is live,
  // so the first open of Settings → Models hits warm React Query + inventory caches.
  useEffect(() => {
    if (!opencodeClient) return;
    let cancelled = false;
    void prewarmWorkspaceProviders({
      client: opencodeClient,
      baseUrl: opencodeBaseUrl,
      directory: selectedWorkspaceRoot || undefined,
      workspaceRoot: selectedWorkspaceRoot || undefined,
    }).catch((error) => {
      if (!cancelled) {
        console.warn("[settings-route] providers prewarm failed", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [opencodeBaseUrl, opencodeClient, selectedWorkspaceRoot]);
}
