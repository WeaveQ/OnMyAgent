/** Busy + empty composer keeps Stop; any sendable draft shows Send (queues). */
export function composerShowsStopButton(input: {
  busy: boolean;
  canSend: boolean;
}): boolean {
  return input.busy && !input.canSend;
}

export function shouldRestoreComposerFocus(input: {
  wasBusy: boolean;
  busy: boolean;
  externalEditorActive: boolean;
}): boolean {
  return input.wasBusy && !input.busy && !input.externalEditorActive;
}
