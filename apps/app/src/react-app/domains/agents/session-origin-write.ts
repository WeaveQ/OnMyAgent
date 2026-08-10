import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";

type SessionOriginWriter = Pick<OnMyAgentServerClient, "upsertSessionOrigin">;

export type SessionOriginWriteInput = {
  client: SessionOriginWriter | null | undefined;
  workspaceId: string;
  sessionId: string;
  kind: "assistant" | "expert";
  agentId?: string | null;
  directory?: string | null;
};

function buildOriginPayload(input: SessionOriginWriteInput) {
  return {
    kind: input.kind,
    ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
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
    .catch(() => undefined);
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
  // Last resort: fire-and-forget so a later settle may still land.
  writeSessionOriginBestEffort(input);
  return false;
}
