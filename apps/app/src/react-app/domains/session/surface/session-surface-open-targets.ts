/**
 * Verify open targets against the workspace artifact resolver and auto-open
 * the highest-confidence target once per session (when not streaming).
 *
 * Session reset must run BEFORE verify (declaration order): on a new session
 * empty targets mark the session initialized with no pre-opened id, so when
 * targets later arrive initialize is skipped and auto-open can fire. Reset
 * after verify would clear the empty init and let the next non-empty verify
 * pre-mark the target, suppressing auto-open.
 */
import { useEffect, useRef, useState } from "react";

import {
  selectAutoOpenTarget,
  type OpenTarget,
} from "../artifacts/open-target";

export type SessionSurfaceOpenTargetsClient = {
  resolveArtifacts: (
    workspaceId: string,
    targets: OpenTarget[],
  ) => Promise<{ items: OpenTarget[] }>;
};

export type UseSessionSurfaceOpenTargetsInput = {
  sessionId: string;
  workspaceId: string;
  client: SessionSurfaceOpenTargetsClient;
  openTargets: OpenTarget[];
  /** Stable fingerprint so effect does not re-fire on referential churn. */
  openTargetsFingerprint: string;
  chatStreaming: boolean;
  onOpenTarget?: (target: OpenTarget, options?: { auto?: boolean }) => void;
  onOpenTargetsChange?: (targets: OpenTarget[]) => void;
};

/** Pure auto-open bookkeeping — same semantics as the pre-extract host. */
export type AutoOpenSessionState = {
  initializedSessionId: string | null;
  /** Target id already treated as "opened" for this session (suppress re-open). */
  autoOpenedTargetId: string | null;
};

export function createAutoOpenSessionState(): AutoOpenSessionState {
  return { initializedSessionId: null, autoOpenedTargetId: null };
}

/** Clear bookkeeping on session switch (must run before first verify). */
export function resetAutoOpenSessionState(): AutoOpenSessionState {
  return createAutoOpenSessionState();
}

/**
 * First verify for a session records the current best auto-open candidate
 * so reopening a session does not re-fire auto-open. Empty first verify
 * records null — later targets in the same session can still auto-open.
 * Subsequent verifies for the same session are no-ops for bookkeeping.
 *
 * @param candidateId Best auto-open target id at init time (null when empty
 *   or when product policy disables auto-open selection).
 */
export function initializeAutoOpenSessionState(
  state: AutoOpenSessionState,
  sessionId: string,
  candidateId: string | null,
): AutoOpenSessionState {
  if (state.initializedSessionId === sessionId) return state;
  return {
    initializedSessionId: sessionId,
    autoOpenedTargetId: candidateId,
  };
}

export function shouldFireAutoOpen(
  state: AutoOpenSessionState,
  targetId: string | null | undefined,
  chatStreaming: boolean,
): boolean {
  if (!targetId || chatStreaming) return false;
  if (state.autoOpenedTargetId === targetId) return false;
  return true;
}

export function markAutoOpened(
  state: AutoOpenSessionState,
  targetId: string,
): AutoOpenSessionState {
  return { ...state, autoOpenedTargetId: targetId };
}

function candidateIdFromTargets(targets: OpenTarget[]): string | null {
  return selectAutoOpenTarget(targets)?.id ?? null;
}

export function useSessionSurfaceOpenTargets(
  input: UseSessionSurfaceOpenTargetsInput,
) {
  const [verifiedOpenTargets, setVerifiedOpenTargets] = useState<OpenTarget[]>(
    [],
  );
  const autoOpenStateRef = useRef<AutoOpenSessionState>(
    createAutoOpenSessionState(),
  );

  const autoOpenTarget = selectAutoOpenTarget(verifiedOpenTargets);

  // 1) Session reset FIRST — same order as pre-extract session-surface.tsx.
  useEffect(() => {
    autoOpenStateRef.current = resetAutoOpenSessionState();
    setVerifiedOpenTargets([]);
  }, [input.sessionId]);

  // 2) Verify artifacts; first init for session may pre-mark auto-open id.
  useEffect(() => {
    let cancelled = false;
    const sessionId = input.sessionId;

    async function verifyTargets() {
      if (!input.openTargets.length) {
        autoOpenStateRef.current = initializeAutoOpenSessionState(
          autoOpenStateRef.current,
          sessionId,
          null,
        );
        setVerifiedOpenTargets([]);
        return;
      }
      try {
        const response = await input.client.resolveArtifacts(
          input.workspaceId,
          input.openTargets,
        );
        if (!cancelled) {
          const nextTargets = response.items as OpenTarget[];
          autoOpenStateRef.current = initializeAutoOpenSessionState(
            autoOpenStateRef.current,
            sessionId,
            candidateIdFromTargets(nextTargets),
          );
          setVerifiedOpenTargets(nextTargets);
        }
      } catch {
        if (!cancelled) {
          const nextTargets = input.openTargets.map((target) => ({
            ...target,
            exists: target.kind === "url",
          }));
          autoOpenStateRef.current = initializeAutoOpenSessionState(
            autoOpenStateRef.current,
            sessionId,
            candidateIdFromTargets(nextTargets),
          );
          setVerifiedOpenTargets(nextTargets);
        }
      }
    }
    void verifyTargets();
    return () => {
      cancelled = true;
    };
  }, [
    input.openTargetsFingerprint,
    input.client,
    input.sessionId,
    input.workspaceId,
    input.openTargets,
  ]);

  // 3) Auto-open newly verified high-confidence targets when not streaming.
  useEffect(() => {
    const targetId = autoOpenTarget?.id ?? null;
    if (
      !shouldFireAutoOpen(
        autoOpenStateRef.current,
        targetId,
        input.chatStreaming,
      )
    ) {
      return;
    }
    if (!autoOpenTarget || !targetId) return;
    autoOpenStateRef.current = markAutoOpened(
      autoOpenStateRef.current,
      targetId,
    );
    input.onOpenTarget?.(autoOpenTarget, { auto: true });
  }, [autoOpenTarget, input.chatStreaming, input.onOpenTarget]);

  // 4) Publish verified list to the host.
  useEffect(() => {
    input.onOpenTargetsChange?.(verifiedOpenTargets);
  }, [input.onOpenTargetsChange, verifiedOpenTargets]);

  return {
    verifiedOpenTargets,
    autoOpenTarget,
  };
}
