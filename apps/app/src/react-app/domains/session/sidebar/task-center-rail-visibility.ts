/**
 * Task Center lives under the account menu (Agent tasks), not the primary
 * rail. Keep the view / deep link valid so the menu can still open it.
 */
export function isTaskCenterRailVisible(): boolean {
  return false;
}
