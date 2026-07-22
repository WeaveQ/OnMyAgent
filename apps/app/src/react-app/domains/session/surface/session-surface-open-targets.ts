/**
 * Verify open targets against the workspace artifact resolver and auto-open
 * the highest-confidence target once per session (when not streaming).
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

export function useSessionSurfaceOpenTargets(
  input: UseSessionSurfaceOpenTargetsInput,
) {
  const [verifiedOpenTargets, setVerifiedOpenTargets] = useState<OpenTarget[]>(
    [],
  );
  const autoOpenedTargetRef = useRef<string | null>(null);
  const initializedAutoOpenSessionRef = useRef<string | null>(null);

  const autoOpenTarget = selectAutoOpenTarget(verifiedOpenTargets);

  useEffect(() => {
    if (!autoOpenTarget || input.chatStreaming) return;
    if (autoOpenedTargetRef.current === autoOpenTarget.id) return;
    autoOpenedTargetRef.current = autoOpenTarget.id;
    input.onOpenTarget?.(autoOpenTarget, { auto: true });
  }, [autoOpenTarget, input.chatStreaming, input.onOpenTarget]);

  useEffect(() => {
    let cancelled = false;
    function initializeAutoOpenState(targets: OpenTarget[]) {
      if (initializedAutoOpenSessionRef.current === input.sessionId) return;
      initializedAutoOpenSessionRef.current = input.sessionId;
      autoOpenedTargetRef.current = selectAutoOpenTarget(targets)?.id ?? null;
    }

    async function verifyTargets() {
      if (!input.openTargets.length) {
        initializeAutoOpenState([]);
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
          initializeAutoOpenState(nextTargets);
          setVerifiedOpenTargets(nextTargets);
        }
      } catch {
        if (!cancelled) {
          const nextTargets = input.openTargets.map((target) => ({
            ...target,
            exists: target.kind === "url",
          }));
          initializeAutoOpenState(nextTargets);
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
    // openTargets identity is covered by fingerprint; include for correctness.
    input.openTargets,
  ]);

  useEffect(() => {
    input.onOpenTargetsChange?.(verifiedOpenTargets);
  }, [input.onOpenTargetsChange, verifiedOpenTargets]);

  /** Reset auto-open bookkeeping when the host switches sessions. */
  useEffect(() => {
    autoOpenedTargetRef.current = null;
    initializedAutoOpenSessionRef.current = null;
    setVerifiedOpenTargets([]);
  }, [input.sessionId]);

  return {
    verifiedOpenTargets,
    autoOpenTarget,
  };
}
