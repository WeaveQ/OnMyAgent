import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";

type SessionOriginWriter = Pick<OnMyAgentServerClient, "upsertSessionOrigin">;

export type SessionOriginWriteInput = {
  client: SessionOriginWriter | null | undefined;
  workspaceId: string;
  sessionId: string;
  kind: "assistant" | "expert";
  agentId?: string | null;
  packageName?: string | null;
  directory?: string | null;
  onFailure?: (failure: SessionOriginWriteFailure) => void;
};

export type SessionOriginWriteFailure = {
  code: "origin_write_failed";
  attempts: number;
  workspaceId: string;
  sessionId: string;
};

function buildOriginPayload(input: SessionOriginWriteInput) {
  return {
    kind: input.kind,
    ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
    ...(input.packageName?.trim() ? { packageName: input.packageName.trim() } : {}),
    ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}),
  };
}

/** Metadata must never delay a just-created conversation or its first send. */
export function writeSessionOriginBestEffort(input: SessionOriginWriteInput) {
  const sessionId = input.sessionId.trim();
  if (!input.client || !input.workspaceId || !sessionId) return;
  void input.client
    .upsertSessionOrigin(
      input.workspaceId,
      sessionId,
      buildOriginPayload(input),
    )
    .catch(() => {
      emitOriginWriteFailure(input, sessionId, 1);
    });
}

/**
 * Await origin persistence for expert create paths so reload recovery has
 * `kind` + `agentId` + `directory`. Retries once; never throws to the caller
 * (caller still owns local expert index / agent map).
 */
export async function writeSessionOriginDurable(
  input: SessionOriginWriteInput,
): Promise<boolean> {
  const sessionId = input.sessionId.trim();
  if (!input.client || !input.workspaceId || !sessionId) return false;
  const payload = buildOriginPayload(input);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await input.client.upsertSessionOrigin(
        input.workspaceId,
        sessionId,
        payload,
      );
      return true;
    } catch {
      // retry once
    }
  }
  emitOriginWriteFailure(input, sessionId, 2);
  return false;
}

function emitOriginWriteFailure(
  input: SessionOriginWriteInput,
  sessionId: string,
  attempts: number,
) {
  const failure: SessionOriginWriteFailure = {
    code: "origin_write_failed",
    attempts,
    workspaceId: input.workspaceId,
    sessionId,
  };
  input.onFailure?.(failure);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("onmyagent:session-origin-write-failed", {
      detail: failure,
    }));
  }
}
