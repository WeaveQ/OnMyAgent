/**
 * Schedule non-critical session-route prewarm work after first paint.
 * Prefer requestIdleCallback; fall back to setTimeout so cold listSessions /
 * selected-session snapshot are not racing inventory prewarm.
 */

/**
 * Long enough that cold listSessions + first surface snapshot finish first.
 * First-install OpenCode index warm often takes several seconds.
 */
export const SESSION_PREWARM_IDLE_TIMEOUT_MS = 8_000;
/** Fallback when requestIdleCallback is unavailable. */
export const SESSION_PREWARM_FALLBACK_DELAY_MS = 4_000;

export type ScheduleIdleWorkInput = {
  run: () => void;
  /** Max wait before forcing run under requestIdleCallback (default 2500). */
  idleTimeoutMs?: number;
  /** setTimeout fallback when idle API is missing (default 600). */
  fallbackDelayMs?: number;
  /**
   * Injected host APIs for tests. Defaults to `window` in the browser.
   */
  host?: {
    requestIdleCallback?: (
      cb: () => void,
      opts?: { timeout?: number },
    ) => number;
    cancelIdleCallback?: (id: number) => void;
    setTimeout: (handler: () => void, timeout: number) => number;
    clearTimeout: (id: number) => void;
  };
};

export type ScheduledIdleWork = {
  /** True when requestIdleCallback path was used. */
  usedIdleCallback: boolean;
  cancel: () => void;
};

function defaultHost(): NonNullable<ScheduleIdleWorkInput["host"]> {
  const win = window as Window & {
    requestIdleCallback?: (
      cb: () => void,
      opts?: { timeout?: number },
    ) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  return {
    requestIdleCallback: win.requestIdleCallback?.bind(win),
    cancelIdleCallback: win.cancelIdleCallback?.bind(win),
    setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
    clearTimeout: (id) => window.clearTimeout(id),
  };
}

/**
 * Run `run` after idle (or short delay). Never invokes synchronously —
 * callers use this so mount effects do not immediately thrash OpenCode.
 */
export function scheduleIdleWork(input: ScheduleIdleWorkInput): ScheduledIdleWork {
  const host = input.host ?? defaultHost();
  const idleTimeoutMs =
    input.idleTimeoutMs ?? SESSION_PREWARM_IDLE_TIMEOUT_MS;
  const fallbackDelayMs =
    input.fallbackDelayMs ?? SESSION_PREWARM_FALLBACK_DELAY_MS;

  if (typeof host.requestIdleCallback === "function") {
    const idleId = host.requestIdleCallback(input.run, {
      timeout: idleTimeoutMs,
    });
    return {
      usedIdleCallback: true,
      cancel: () => {
        host.cancelIdleCallback?.(idleId);
      },
    };
  }

  const timerId = host.setTimeout(input.run, fallbackDelayMs);
  return {
    usedIdleCallback: false,
    cancel: () => {
      host.clearTimeout(timerId);
    },
  };
}
