/** @jsxImportSource react */
import { useEffect, useState } from "react";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";

import { ensureWorkspaceSessionSync, trackWorkspaceSessionsSync } from "./session-sync";
import { useSessionActivityStore } from "../status/session-activity-store";
import {
  synchronizeCanonicalRuntimeSession,
  type CanonicalRuntimeSyncMode,
} from "./canonical-runtime-sync";

type ReactSessionRuntimeProps = {
  workspaceId: string;
  sessionId: string | null;
  activeSessionIds?: string[];
  directory?: string;
  opencodeBaseUrl: string;
  onmyagentToken: string;
  client: OnMyAgentServerClient;
  onSessionUpdated?: (update: { sessionId: string; info: Record<string, unknown> }) => void;
  onSessionStatus?: (update: { sessionId: string; status: SessionStatus }) => void;
};

export function ReactSessionRuntime(props: ReactSessionRuntimeProps) {
  const [mode, setMode] = useState<CanonicalRuntimeSyncMode | "resolving">(
    "resolving",
  );

  useEffect(() => {
    setMode("resolving");
    if (!props.sessionId) {
      setMode("legacy-opencode");
      return;
    }
    const controller = new AbortController();
    void synchronizeCanonicalRuntimeSession({
      client: props.client,
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
      signal: controller.signal,
      onMode: setMode,
      onSessionStatus: props.onSessionStatus,
    }).catch((error) => {
      if (controller.signal.aborted) return;
      const message = error instanceof Error
        ? error.message
        : "Canonical runtime synchronization failed";
      useSessionActivityStore.getState().setError(
        props.workspaceId,
        props.sessionId!,
        message,
      );
    });
    return () => controller.abort();
  }, [props.client, props.sessionId, props.workspaceId, props.onSessionStatus]);

  useEffect(() => {
    const input = {
      workspaceId: props.workspaceId,
      baseUrl: props.opencodeBaseUrl,
      directory: props.directory,
      onmyagentToken: props.onmyagentToken,
      onSessionUpdated: props.onSessionUpdated,
      onSessionStatus: props.onSessionStatus,
    };
    const releaseWorkspace = ensureWorkspaceSessionSync(input);
    // Full message stream only for the focused session; other active ids are
    // demoted (status via activity store still updates on the shared SSE).
    const releaseSessions = trackWorkspaceSessionsSync(
      input,
      [
        ...(mode === "legacy-opencode" ? [props.sessionId] : []),
        ...(props.activeSessionIds ?? []).filter(
          (sessionId) => sessionId !== props.sessionId,
        ),
      ],
      {
        focusedSessionId:
          mode === "legacy-opencode" ? props.sessionId : null,
      },
    );
    return () => {
      releaseSessions();
      releaseWorkspace();
    };
  }, [mode, props.workspaceId, props.sessionId, props.activeSessionIds, props.directory, props.opencodeBaseUrl, props.onmyagentToken, props.onSessionUpdated, props.onSessionStatus]);

  return null;
}
