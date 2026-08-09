import type { SessionOriginRecord } from "@onmyagent/types/server";
import {
  readAssistantSessionWorkspaces,
} from "../../capabilities/session-identity/assistant-session-workspaces";
import {
  addExpertSession,
  readExpertSessionIds,
  removeExpertSession,
} from "./agent-session-state";
import {
  readCustomAgentIdForSession,
  writeCustomAgentIdForSession,
} from "./agent-registry-store";

export const sessionOriginsChangedEvent = "onmyagent:session-origins-changed";

function notifySessionOriginsChanged(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(sessionOriginsChangedEvent, {
    detail: { workspaceId },
  }));
}

export function reconcileSessionOrigins(input: {
  localWorkspaceId: string;
  originWorkspaceId: string;
  realSessionIds: ReadonlySet<string>;
  origins: SessionOriginRecord[];
}) {
  for (const origin of input.origins) {
    if (origin.workspaceId !== input.originWorkspaceId) continue;
    if (!input.realSessionIds.has(origin.sessionId)) {
      // Sidebar lists are bounded and the cold path intentionally skips some
      // assistant directories. Absence here is unknown, not an authoritative
      // deletion signal; server DELETE owns durable origin cleanup.
      continue;
    }
    if (origin.kind === "expert") {
      addExpertSession(origin.sessionId);
      if (origin.agentId?.trim()) {
        writeCustomAgentIdForSession(origin.sessionId, origin.agentId.trim());
      }
      continue;
    }
    removeExpertSession(origin.sessionId);
  }
  notifySessionOriginsChanged(input.localWorkspaceId);
}

type SessionOriginMigrationClient = {
  upsertSessionOrigin: (
    workspaceId: string,
    sessionId: string,
    payload: { kind: "assistant" | "expert"; agentId?: string; directory?: string },
  ) => Promise<unknown>;
};

/**
 * Best-effort bridge for pre-origin local metadata. It deliberately only uses
 * the old explicit expert index, never the generic custom-agent map.
 */
export async function migrateLegacySessionOrigins(input: {
  client: SessionOriginMigrationClient;
  localWorkspaceId: string;
  originWorkspaceId: string;
  realSessionIds: ReadonlySet<string>;
  origins: SessionOriginRecord[];
}) {
  const existingIds = new Set(input.origins.map((origin) => origin.sessionId));
  const writes: Promise<unknown>[] = [];
  for (const sessionId of readExpertSessionIds()) {
    if (!input.realSessionIds.has(sessionId) || existingIds.has(sessionId)) continue;
    const agentId = readCustomAgentIdForSession(sessionId);
    if (!agentId) continue;
    writes.push(input.client.upsertSessionOrigin(input.originWorkspaceId, sessionId, {
      kind: "expert",
      agentId,
    }));
  }
  for (const record of readAssistantSessionWorkspaces(input.localWorkspaceId)) {
    if (!input.realSessionIds.has(record.sessionId) || existingIds.has(record.sessionId)) continue;
    writes.push(input.client.upsertSessionOrigin(input.originWorkspaceId, record.sessionId, {
      kind: "assistant",
      directory: record.directory,
    }));
  }
  await Promise.allSettled(writes);
}
