/**
 * Transcript interruption notices, compacting markers, and stall recovery
 * bookkeeping for SessionSurface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";

import {
  readSessionTranscriptNotices,
  writeSessionTranscriptNotices,
} from "../../../../app/lib/session-transcript-notices";
import type { SessionTranscriptDivider } from "./message-list";
import type { SessionActivityStatus } from "../status/session-activity-store";
import {
  MAX_TRANSCRIPT_NOTICES_PER_SESSION,
} from "./session-surface-constants";
import {
  transcriptNoticeLabel,
  type SessionTranscriptNotice,
} from "./plan-goal/goal-runtime";

export function useSessionSurfaceTranscriptNotices(input: {
  sessionId: string;
  rawRenderedMessageCount: number;
  renderedMessageCount: number;
  sessionActivityStatus: SessionActivityStatus;
  autoApprovedPermissionNoticeId?: string | null;
}) {
  const [compactBoundaryBySessionId, setCompactBoundaryBySessionId] =
    useState<Record<string, number>>({});
  const [transcriptNoticesBySessionId, setTranscriptNoticesBySessionId] =
    useState<Record<string, SessionTranscriptNotice[]>>(
      readSessionTranscriptNotices,
    );
  const [stallRecoveryBySessionId, setStallRecoveryBySessionId] =
    useState<Record<string, boolean>>({});
  const compactWasActiveRef = useRef<Record<string, boolean>>({});
  const autoApprovedPermissionNoticeRef = useRef<Record<string, string>>({});

  useEffect(() => {
    writeSessionTranscriptNotices(transcriptNoticesBySessionId);
  }, [transcriptNoticesBySessionId]);

  const compactBoundary = compactBoundaryBySessionId[input.sessionId] ?? null;

  const appendTranscriptNotice = useCallback(
    (notice: SessionTranscriptNotice) => {
      setTranscriptNoticesBySessionId((current) => {
        const existing = current[input.sessionId] ?? [];
        return {
          ...current,
          [input.sessionId]: [...existing, notice].slice(
            -MAX_TRANSCRIPT_NOTICES_PER_SESSION,
          ),
        };
      });
    },
    [input.sessionId],
  );

  const updateLatestTranscriptNotice = useCallback(
    (
      predicate: (notice: SessionTranscriptNotice) => boolean,
      update: (notice: SessionTranscriptNotice) => SessionTranscriptNotice,
    ) => {
      setTranscriptNoticesBySessionId((current) => {
        const existing = current[input.sessionId] ?? [];
        let targetIndex = -1;
        for (let index = existing.length - 1; index >= 0; index -= 1) {
          const notice = existing[index];
          if (notice && predicate(notice)) {
            targetIndex = index;
            break;
          }
        }
        if (targetIndex < 0) return current;
        const next = [...existing];
        const target = next[targetIndex];
        if (!target) return current;
        next[targetIndex] = update(target);
        return { ...current, [input.sessionId]: next };
      });
    },
    [input.sessionId],
  );

  useEffect(() => {
    const noticeId = input.autoApprovedPermissionNoticeId?.trim();
    if (!noticeId) return;
    if (autoApprovedPermissionNoticeRef.current[input.sessionId] === noticeId) {
      return;
    }
    autoApprovedPermissionNoticeRef.current = {
      ...autoApprovedPermissionNoticeRef.current,
      [input.sessionId]: noticeId,
    };
    appendTranscriptNotice({
      id: `${input.sessionId}:permission-auto-approved:${noticeId}`,
      kind: "permission-auto-approved",
      afterMessageCount: input.renderedMessageCount,
    });
  }, [
    appendTranscriptNotice,
    input.autoApprovedPermissionNoticeId,
    input.renderedMessageCount,
    input.sessionId,
  ]);

  useEffect(() => {
    const compacting = input.sessionActivityStatus === "compacting";
    const wasCompacting = compactWasActiveRef.current[input.sessionId] === true;
    if (compacting) {
      if (!wasCompacting) {
        setCompactBoundaryBySessionId((current) => ({
          ...current,
          [input.sessionId]: input.rawRenderedMessageCount,
        }));
        appendTranscriptNotice({
          id: `${input.sessionId}:compacting:${input.renderedMessageCount}:${Date.now()}`,
          kind: "compacting",
          afterMessageCount: input.renderedMessageCount,
        });
      }
      compactWasActiveRef.current = {
        ...compactWasActiveRef.current,
        [input.sessionId]: true,
      };
      return;
    }
    if (wasCompacting) {
      compactWasActiveRef.current = {
        ...compactWasActiveRef.current,
        [input.sessionId]: false,
      };
      updateLatestTranscriptNotice(
        (notice) => notice.kind === "compacting",
        (notice) => ({ ...notice, kind: "compacted" }),
      );
    }
  }, [
    appendTranscriptNotice,
    input.rawRenderedMessageCount,
    input.renderedMessageCount,
    input.sessionActivityStatus,
    input.sessionId,
    updateLatestTranscriptNotice,
  ]);

  const markStallRecovery = useCallback(() => {
    setStallRecoveryBySessionId((current) => {
      if (current[input.sessionId]) return current;
      return { ...current, [input.sessionId]: true };
    });
  }, [input.sessionId]);

  const interruptionDividers = useMemo<SessionTranscriptDivider[]>(() => {
    const notices = transcriptNoticesBySessionId[input.sessionId] ?? [];
    return notices.map((notice) => ({
      id: notice.id,
      afterMessageCount: notice.afterMessageCount,
      label: transcriptNoticeLabel(notice),
      variant: notice.kind,
    }));
  }, [input.sessionId, transcriptNoticesBySessionId]);

  return {
    compactBoundary,
    transcriptNoticesBySessionId,
    setTranscriptNoticesBySessionId,
    stallRecoveryBySessionId,
    setStallRecoveryBySessionId,
    markStallRecovery,
    appendTranscriptNotice,
    updateLatestTranscriptNotice,
    interruptionDividers,
  };
}

/** Filter compaction messages using the compact boundary from notices hook. */
export function useSessionSurfaceRenderedMessages(input: {
  rawMessages: UIMessage[];
  compactBoundary: number | null;
  filterCompactionMessages: (
    messages: UIMessage[],
    boundary: number | null,
  ) => UIMessage[];
}) {
  return useMemo(
    () =>
      input.filterCompactionMessages(input.rawMessages, input.compactBoundary),
    [input.compactBoundary, input.filterCompactionMessages, input.rawMessages],
  );
}
