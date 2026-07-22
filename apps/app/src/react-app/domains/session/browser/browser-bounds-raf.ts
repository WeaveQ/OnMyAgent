/** Pure policy for EmbeddedBrowserViewport continuous bounds rAF. */

/**
 * Whether a continuous requestAnimationFrame bounds loop should keep running
 * (or be started). False when the viewport is disposed or inactive so inactive
 * mounts do not burn main-thread frames.
 */
export function shouldRunBrowserBoundsRaf(input: {
  disposed: boolean;
  active: boolean;
}): boolean {
  return !input.disposed && input.active;
}

/**
 * Whether to kick the bounds loop when the host effect (re)runs.
 * Must re-run the host effect when `active` becomes true after a false start.
 */
export function shouldStartBrowserBoundsLoop(active: boolean): boolean {
  return shouldRunBrowserBoundsRaf({ disposed: false, active });
}
