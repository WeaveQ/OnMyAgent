/** @jsxImportSource react */
import { useEffect } from "react";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";

import { ensureWorkspaceSessionSync, trackWorkspaceSessionsSync } from "./session-sync";

type ReactSessionRuntimeProps = {
  workspaceId: string;
  sessionId: string | null;
  activeSessionIds?: string[];
  directory?: string;
  opencodeBaseUrl: string;
  onmyagentToken: string;
  onSessionUpdated?: (update: { sessionId: string; info: Record<string, unknown> }) => void;
  onSessionStatus?: (update: { sessionId: string; status: SessionStatus }) => void;
};

export function ReactSessionRuntime(props: ReactSessionRuntimeProps) {
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
      [props.sessionId, ...(props.activeSessionIds ?? [])],
      { focusedSessionId: props.sessionId },
    );
    return () => {
      releaseSessions();
      releaseWorkspace();
    };
  }, [props.workspaceId, props.sessionId, props.activeSessionIds, props.directory, props.opencodeBaseUrl, props.onmyagentToken, props.onSessionUpdated, props.onSessionStatus]);

  return null;
}
