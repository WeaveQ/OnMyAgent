/**
 * Boot shell latch policy for the session route.
 *
 * Product contract (never hang on the ready splash with routeReady false):
 * - Ideal: assistant empty-home commits → onStaticHomeReady → routeReady
 * - Fail-safe: after route refresh settles, a hard deadline forces markShellReady
 * - Non-home routes (session selected / non-assistant): mark immediately in finally
 * - Standalone routes that unmount SessionRoute (/welcome, /signin, /onboarding)
 *   must call markRouteReady on mount. /welcome is the cold-start onboarding
 *   path: SessionRoute redirects there before its deadline can fire.
 *
 * `phase === "ready"` only updates overlay copy; dismissing still needs routeReady.
 */

/** Fail-safe: never leave the overlay waiting forever for static home paint. */
export const BOOT_STATIC_HOME_DEADLINE_MS = 2_000;

export type BootShellReadyAction =
  | { type: "mark-immediately" }
  | { type: "wait-for-static-home"; deadlineMs: number };

/**
 * After route refresh settles, decide how to release the boot overlay shell latch.
 */
export function planBootShellReadyAfterRefresh(
  waitForStaticHomeFirstPaint: boolean,
): BootShellReadyAction {
  if (!waitForStaticHomeFirstPaint) {
    return { type: "mark-immediately" };
  }
  return {
    type: "wait-for-static-home",
    deadlineMs: BOOT_STATIC_HOME_DEADLINE_MS,
  };
}

/**
 * Whether the assistant route should release the static-home boot latch.
 * Empty session id is enough — do not gate on primary rail / isPrimarySessionView,
 * or cold starts on skills/market/etc. never dismiss the overlay.
 */
export function shouldNotifyStaticHomeReady(
  selectedSessionId: string | null | undefined,
): boolean {
  return selectedSessionId == null || selectedSessionId === "";
}
