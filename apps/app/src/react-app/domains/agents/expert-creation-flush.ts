import { shouldFlushComposerOnExpertCreate } from "./expert-session-lifecycle";

/**
 * Module-level create-flush latch for the current save attempt.
 *
 * Lives in its own neutral module (not in expert-creation-actions, which
 * imports the page component) so the page can drive the latch without creating
 * a circular import with the actions hook.
 */
let expertCreateComposerFlushDone = false;

/** Call when opening a create-save path so flush can run at most once. */
export function beginExpertCreateSaveAttempt(): void {
  expertCreateComposerFlushDone = false;
}

/**
 * Returns true the first time per save attempt (composer shell flush).
 * Subsequent calls in the same attempt return false.
 */
export function consumeExpertCreateComposerFlush(): boolean {
  if (!shouldFlushComposerOnExpertCreate(expertCreateComposerFlushDone)) {
    return false;
  }
  expertCreateComposerFlushDone = true;
  return true;
}
