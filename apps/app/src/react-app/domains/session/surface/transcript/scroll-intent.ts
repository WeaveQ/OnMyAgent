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

export function shouldPauseTranscriptFollowOnWheel(deltaY: number) {
  return deltaY < -3;
}

type AutoStickTranscriptGrowthOptions = {
  grew: boolean;
  stickyBottom: boolean;
  active: boolean;
  userInteracting: boolean;
  sessionChangeScroll?: "bottom" | "top";
};

export function shouldAutoStickTranscriptGrowth(
  options: AutoStickTranscriptGrowthOptions,
) {
  return (
    options.grew &&
    options.stickyBottom &&
    options.active &&
    !options.userInteracting &&
    options.sessionChangeScroll !== "top"
  );
}
