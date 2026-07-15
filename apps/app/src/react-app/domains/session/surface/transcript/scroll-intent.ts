export type TranscriptScrollIntent =
  | "interrupt-follow"
  | "follow-frame"
  | "restore-follow"
  | "manual-browse"
  | "passive";

type ClassifyTranscriptScrollIntentOptions = {
  programmatic: boolean;
  userGestured: boolean;
  scrolledUp: boolean;
  exactlyAtBottom: boolean;
};

export function classifyTranscriptScrollIntent(
  options: ClassifyTranscriptScrollIntentOptions,
): TranscriptScrollIntent {
  if (options.programmatic) {
    return options.userGestured || options.scrolledUp
      ? "interrupt-follow"
      : "follow-frame";
  }
  if (options.userGestured || options.scrolledUp) {
    return options.exactlyAtBottom ? "restore-follow" : "manual-browse";
  }
  return options.exactlyAtBottom ? "restore-follow" : "passive";
}
