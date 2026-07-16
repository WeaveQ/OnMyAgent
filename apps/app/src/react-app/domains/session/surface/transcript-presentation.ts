export const DEFAULT_TRANSCRIPT_MAX_CONTENT_WIDTH = 832;

export function computeTranscriptMaxContentWidth(containerWidth: number) {
  if (containerWidth <= 1_200) return DEFAULT_TRANSCRIPT_MAX_CONTENT_WIDTH;
  if (containerWidth <= 1_600) return containerWidth * 0.65;
  if (containerWidth <= 2_000) return containerWidth * 0.6;
  return Math.min(containerWidth * 0.55, 1_400);
}

export function formatTranscriptDuration(durationMs: number) {
  if (durationMs < 0) return "0s";

  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

type TranscriptMessageTimeOptions = {
  locale: string;
  now: Date;
  yesterdayLabel: string;
};

export function formatTranscriptMessageTime(
  timestamp: number | null | undefined,
  options: TranscriptMessageTimeOptions,
) {
  if (timestamp === null || timestamp === undefined) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const time = new Intl.DateTimeFormat(options.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);

  if (date.toDateString() === options.now.toDateString()) return time;

  const yesterday = new Date(options.now);
  yesterday.setDate(options.now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `${options.yesterdayLabel} ${time}`;
  }

  const includeYear = date.getFullYear() !== options.now.getFullYear();
  const calendarDate = new Intl.DateTimeFormat(options.locale, {
    ...(includeYear ? { year: "numeric" } : {}),
    month: "short",
    day: "numeric",
  }).format(date);
  return `${calendarDate} ${time}`;
}
