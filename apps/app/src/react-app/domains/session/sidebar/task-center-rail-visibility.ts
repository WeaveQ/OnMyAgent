/**
 * Task Center stays on the primary rail in local Vite/dev only.
 * Packaged / production builds hide the entry (deep links fall back to Home).
 */
export function isTaskCenterRailVisible(): boolean {
  return import.meta.env.PROD !== true;
}
