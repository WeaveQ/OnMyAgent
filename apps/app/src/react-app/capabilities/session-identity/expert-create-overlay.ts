/**
 * Create-time overlay: session→agent bindings that are not yet in Directory.
 * Expires when the projection includes the session, or create/delete ends.
 */

export type ExpertCreateOverlayEntry = {
  sessionId: string;
  agentId: string;
  operationId?: string;
};

export function expireExpertCreateOverlay(
  overlay: ReadonlyArray<ExpertCreateOverlayEntry>,
  sessionIds: ReadonlySet<string>,
): ExpertCreateOverlayEntry[] {
  return overlay.filter((entry) => {
    const sessionId = entry.sessionId.trim();
    return sessionId.length > 0 && !sessionIds.has(sessionId);
  });
}

export function mergeExpertIdentityWithOverlay(input: {
  sessionIds: ReadonlySet<string>;
  agentIdBySessionId: ReadonlyMap<string, string>;
  overlay: ReadonlyArray<ExpertCreateOverlayEntry>;
}): {
  sessionIds: Set<string>;
  agentIdBySessionId: Map<string, string>;
} {
  const live = expireExpertCreateOverlay(input.overlay, input.sessionIds);
  const sessionIds = new Set(input.sessionIds);
  const agentIdBySessionId = new Map(input.agentIdBySessionId);
  for (const entry of live) {
    sessionIds.add(entry.sessionId);
    agentIdBySessionId.set(entry.sessionId, entry.agentId);
  }
  return { sessionIds, agentIdBySessionId };
}

export function sameExpertIdentityIndex(
  left: { sessionIds: ReadonlySet<string>; agentIdBySessionId: ReadonlyMap<string, string> },
  right: { sessionIds: ReadonlySet<string>; agentIdBySessionId: ReadonlyMap<string, string> },
): boolean {
  if (left === right) return true;
  if (left.sessionIds.size !== right.sessionIds.size) return false;
  if (left.agentIdBySessionId.size !== right.agentIdBySessionId.size) return false;
  for (const sessionId of left.sessionIds) {
    if (!right.sessionIds.has(sessionId)) return false;
    if (left.agentIdBySessionId.get(sessionId) !== right.agentIdBySessionId.get(sessionId)) {
      return false;
    }
  }
  return true;
}

export function sameExpertCreateOverlay(
  left: ReadonlyArray<ExpertCreateOverlayEntry>,
  right: ReadonlyArray<ExpertCreateOverlayEntry>,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other?.sessionId === entry.sessionId && other?.agentId === entry.agentId;
  });
}
