/**
 * Pure helper: pick among the three browser/desktop control surfaces.
 * Keep rules deterministic and free of I/O so agents and UI can share them.
 *
 * Surfaces (also documented in each skill's "Choose the right surface" table):
 * - browser-automation: OnMyAgent in-app browser (no real Chrome logins)
 * - browser-skill: real Chrome/Edge via external `bsk` + extension
 * - computer-use: native macOS app UI (not web page automation)
 */

export type BrowserSurfaceId =
  | "browser-automation"
  | "browser-skill"
  | "computer-use";

export type BrowserSurfaceIntent = {
  /** Need cookies / sessions from the user's real Chrome or Edge profile. */
  needsRealBrowserLogins?: boolean;
  /** Target is a native macOS app UI, not a web page. */
  needsNativeAppUi?: boolean;
  /** Prefer the in-app Browser panel / preview when logins and native UI are not required. */
  wantsInAppPreview?: boolean;
};

/**
 * Recommend which surface to use for a task intent.
 *
 * Priority:
 * 1. Native app UI → computer-use
 * 2. Real browser logins/cookies → browser-skill
 * 3. Otherwise → browser-automation (in-app; default for web / in-app preview)
 */
export function recommendBrowserSurface(
  intent: BrowserSurfaceIntent = {},
): BrowserSurfaceId {
  if (intent.needsNativeAppUi) {
    return "computer-use";
  }
  if (intent.needsRealBrowserLogins) {
    return "browser-skill";
  }
  // wantsInAppPreview and the empty default both map to in-app automation.
  return "browser-automation";
}
