export const SETTINGS_DEVELOPER_MODE_KEY = "onmyagent.developerMode";
export const SETTINGS_HIDE_TITLEBAR_KEY = "onmyagent.react.settings.hide-titlebar";
export const SETTINGS_UPDATE_AUTO_CHECK_KEY = "onmyagent.react.settings.update-auto-check";
export const SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY = "onmyagent.react.settings.update-auto-download";

export function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

export function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {}
}
