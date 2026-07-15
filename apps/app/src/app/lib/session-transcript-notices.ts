const SESSION_TRANSCRIPT_NOTICES_KEY = "onmyagent.session-transcript-notices.v2";
const LEGACY_SESSION_TRANSCRIPT_NOTICES_KEY = "onmyagent.session-transcript-notices.v1";

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
  runKey?: string;
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
    ...(typeof value.runKey === "string" && value.runKey.trim()
      ? { runKey: value.runKey }
      : {}),
    ...(typeof value.runStartedAt === "number" ? { runStartedAt: value.runStartedAt } : {}),
    ...(typeof value.elapsedMs === "number" ? { elapsedMs: value.elapsedMs } : {}),
  };
}

function isTerminalNotice(notice: PersistedSessionTranscriptNotice) {
  return notice.kind === "cancelled" || notice.kind === "stopped";
}

export function normalizeSessionTranscriptNotices(
  value: unknown,
): Record<string, PersistedSessionTranscriptNotice[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([sessionId, notices]) => {
      if (!Array.isArray(notices) || !sessionId.trim()) return [];
      const valid = notices.flatMap((notice) => {
        const parsedNotice = parseNotice(notice);
        return parsedNotice ? [parsedNotice] : [];
      });
      let latestLegacyTerminalIndex = -1;
      valid.forEach((notice, index) => {
        if (isTerminalNotice(notice) && !notice.runKey) {
          latestLegacyTerminalIndex = index;
        }
      });
      const normalized = valid.flatMap((notice, index) => {
        if (!isTerminalNotice(notice) || notice.runKey) return [notice];
        if (index !== latestLegacyTerminalIndex) return [];
        return [{ ...notice, runKey: `legacy:${sessionId}` }];
      });
      return normalized.length ? [[sessionId, normalized] as const] : [];
    }),
  );
}

function parseStoredNotices(raw: string | null) {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return normalizeSessionTranscriptNotices(parsed);
}

export function readSessionTranscriptNotices(): Record<string, PersistedSessionTranscriptNotice[]> {
  if (typeof window === "undefined") return {};
  try {
    const current = window.localStorage.getItem(SESSION_TRANSCRIPT_NOTICES_KEY);
    if (current) return parseStoredNotices(current);
    const legacy = window.localStorage.getItem(LEGACY_SESSION_TRANSCRIPT_NOTICES_KEY);
    if (!legacy) return {};
    const migrated = parseStoredNotices(legacy);
    try {
      window.localStorage.setItem(SESSION_TRANSCRIPT_NOTICES_KEY, JSON.stringify(migrated));
      window.localStorage.removeItem(LEGACY_SESSION_TRANSCRIPT_NOTICES_KEY);
    } catch {
      return migrated;
    }
    return migrated;
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
