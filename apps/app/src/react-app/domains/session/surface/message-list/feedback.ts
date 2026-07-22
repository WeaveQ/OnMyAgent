export type TranscriptFeedbackValue = "like" | "dislike";

const TRANSCRIPT_FEEDBACK_STORAGE_KEY = "onmyagent.transcriptFeedbackState.v1";

export function isTranscriptFeedbackValue(value: unknown): value is TranscriptFeedbackValue {
  return value === "like" || value === "dislike";
}

export function readTranscriptFeedbackState(): Record<string, TranscriptFeedbackValue> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TRANSCRIPT_FEEDBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, TranscriptFeedbackValue] =>
        isTranscriptFeedbackValue(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function persistTranscriptFeedbackState(state: Record<string, TranscriptFeedbackValue>) {
  try {
    window.localStorage.setItem(TRANSCRIPT_FEEDBACK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Feedback remains usable for this render when storage is unavailable.
  }
}

export function toggleTranscriptFeedback(
  state: Record<string, TranscriptFeedbackValue>,
  messageId: string,
  value: TranscriptFeedbackValue,
) {
  if (state[messageId] === value) {
    const next = { ...state };
    delete next[messageId];
    return next;
  }
  return { ...state, [messageId]: value };
}
