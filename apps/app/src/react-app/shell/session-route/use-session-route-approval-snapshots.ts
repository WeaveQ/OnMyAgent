import { useEffect } from "react";
import { unwrap } from "../../../app/lib/opencode";
import type { Client } from "../../../app/types";
import {
  seedPermissionState,
  seedQuestionState,
} from "../../domains/session";

export function useSessionRouteApprovalSnapshots(input: {
  runtimeKind: "opencode" | "grok-build" | null | undefined;
  opencodeClient: Client | null;
  workspaceId: string;
  sessionId: string | null;
  workspaceRoot: string;
}): void {
  const {
    runtimeKind,
    opencodeClient,
    workspaceId,
    sessionId,
    workspaceRoot,
  } = input;
  useEffect(() => {
    if (runtimeKind === "grok-build" || !opencodeClient || !workspaceId || !sessionId) {
      return;
    }
    let cancelled = false;
    const directory = workspaceRoot || undefined;
    void (async () => {
      const snapshotStartedAt = Date.now();
      try {
        const list = unwrap(await opencodeClient.permission.list({ directory }));
        if (!cancelled) {
          seedPermissionState(workspaceId, sessionId, list, { snapshotStartedAt });
        }
      } catch {
        // Keep event-synced permission state if the snapshot read fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opencodeClient, runtimeKind, sessionId, workspaceId, workspaceRoot]);

  useEffect(() => {
    if (runtimeKind === "grok-build" || !opencodeClient || !workspaceId || !sessionId) {
      return;
    }
    let cancelled = false;
    const directory = workspaceRoot || undefined;
    void (async () => {
      const snapshotStartedAt = Date.now();
      try {
        const list = unwrap(await opencodeClient.question.list({ directory }));
        if (!cancelled) {
          seedQuestionState(workspaceId, sessionId, list, { snapshotStartedAt });
        }
      } catch {
        // Keep event-synced question state if the snapshot read fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opencodeClient, runtimeKind, sessionId, workspaceId, workspaceRoot]);
}
