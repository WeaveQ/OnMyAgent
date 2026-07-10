const SESSION_TRANSCRIPT_NOTICES_KEY = "onmyagent.session-transcript-notices.v1";

export type PersistedSessionTranscriptNotice = {
  id: string;
  kind:
    | "cancelled"
    | "stopped"
    | "compacting"
    | "compacted"
    | "stalled"
    | "permission-rejected"
    | "permission-auto-approved";
  afterMessageCount: number;
  runStartedAt?: number;
  elapsedMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNoticeKind(
  value: unknown,
): value is PersistedSessionTranscriptNotice["kind"] {
  return (
    value === "cancelled" ||
    value === "stopped" ||
    value === "compacting" ||
    value === "compacted" ||
    value === "stalled" ||
    value === "permission-rejected" ||
    value === "permission-auto-approved"
  );
}

function parseNotice(value: unknown): PersistedSessionTranscriptNotice | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string") {
    return null;
  }
  if (
    typeof value.afterMessageCount !== "number" ||
    !Number.isInteger(value.afterMessageCount) ||
    value.afterMessageCount < 0 ||
    !isNoticeKind(value.kind)
  ) return null;
  return {
    id: value.id,
    kind: value.kind,
    afterMessageCount: value.afterMessageCount,
    ...(typeof value.runStartedAt === "number" ? { runStartedAt: value.runStartedAt } : {}),
    ...(typeof value.elapsedMs === "number" ? { elapsedMs: value.elapsedMs } : {}),
  };
}

export function readSessionTranscriptNotices(): Record<string, PersistedSessionTranscriptNotice[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_TRANSCRIPT_NOTICES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([sessionId, notices]) => {
      if (!Array.isArray(notices) || !sessionId.trim()) return [];
      const valid = notices.flatMap((notice) => {
        const parsedNotice = parseNotice(notice);
        return parsedNotice ? [parsedNotice] : [];
      });
      return valid.length ? [[sessionId, valid] as const] : [];
    }));
  } catch {
    return {};
  }
}

export function writeSessionTranscriptNotices(
  notices: Record<string, PersistedSessionTranscriptNotice[]>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_TRANSCRIPT_NOTICES_KEY, JSON.stringify(notices));
  } catch {
    // The timeline remains usable even when browser storage is unavailable.
  }
}
