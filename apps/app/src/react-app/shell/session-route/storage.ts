import { readSeenProviderIds } from "./model-options";
import { reloadAfterOrgOnboardingKey } from "./state";
import { SETTINGS_DEVELOPER_MODE_KEY, readStoredBoolean } from "../settings-route-storage";

export function readOrgOnboardingReloadRequested() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(reloadAfterOrgOnboardingKey) === "1";
  } catch {
    return false;
  }
}

export function clearOrgOnboardingReloadRequest() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(reloadAfterOrgOnboardingKey);
  } catch {}
}

export function readWindowSeenProviderIds() {
  if (typeof window === "undefined") return new Set<string>();
  return readSeenProviderIds(window.localStorage);
}

export function readDeveloperModeEnabled() {
  return readStoredBoolean(SETTINGS_DEVELOPER_MODE_KEY, false);
}
