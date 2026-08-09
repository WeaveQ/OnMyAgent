import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";

type SessionOriginWriter = Pick<OnMyAgentServerClient, "upsertSessionOrigin">;

/** Metadata must never delay a just-created conversation or its first send. */
export function writeSessionOriginBestEffort(input: {
  client: SessionOriginWriter | null | undefined;
  workspaceId: string;
  sessionId: string;
  kind: "assistant" | "expert";
  agentId?: string | null;
  directory?: string | null;
}) {
  const sessionId = input.sessionId.trim();
  if (!input.client || !input.workspaceId || !sessionId) return;
  void input.client.upsertSessionOrigin(input.workspaceId, sessionId, {
    kind: input.kind,
    ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
    ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}),
  }).catch(() => undefined);
}
