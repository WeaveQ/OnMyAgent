export function shouldRestoreComposerFocus(input: {
  wasBusy: boolean;
  busy: boolean;
  externalEditorActive: boolean;
}): boolean {
  return input.wasBusy && !input.busy && !input.externalEditorActive;
}
