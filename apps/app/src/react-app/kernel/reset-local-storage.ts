/**
 * Renderer-side localStorage cleanup for Settings recovery / debug reset.
 *
 * - onboarding: re-enter welcome guide + reset app preferences / profile
 *   (keeps language + theme; does not wipe Chromium-wide storage)
 * - all: clear entire localStorage
 */

import {
  MODEL_PREF_KEY,
  SESSION_MODEL_PREF_KEY,
  THINKING_PREF_KEY,
  VARIANT_PREF_KEY,
} from "../../app/constants";

export type ResetLocalStorageMode = "onboarding" | "all";

const PREFS_STORAGE_KEY = "onmyagent.preferences";
const UI_STORAGE_KEY = "onmyagent.ui";

/** Explicit first-run / org onboarding markers (debug + recovery). */
const ONBOARDING_MARKER_KEYS = [
  "onmyagent.acknowledgedProviders",
  "onmyagent.orgOnboardingSeen",
  "onmyagent.reloadAfterOrgOnboarding",
  "onmyagent.seenProviderIds",
] as const;

/**
 * Fresh preferences after "reset onboarding" — mirrors LocalProvider INITIAL_PREFS
 * with hasCompletedOnboarding=false and empty profile.
 */
const RESET_ONBOARDING_PREFS = {
  showThinking: true,
  responseTone: "pragmatic",
  customInstructions: "",
  modelVariant: null,
  defaultModel: null,
  desktopNotifyOnAgentReady: false,
  desktopNotificationsEnabled: true,
  soundNotifyOnAgentReady: true,
  launchAtLogin: true,
  keepSystemAwake: false,
  dockUnreadBadge: true,
  menuBarStatusItem: true,
  conversationWidth: "fixed",
  keymapOverrides: {},
  appSnapshotHotkey: "double-command",
  releaseChannel: "stable",
  featureFlags: { microsandboxCreateSandbox: true },
  hasCompletedOnboarding: false,
  onboardingProfile: null,
  conversationMemory: {
    enabled: false,
    autoCapture: false,
    items: [],
    pending: [],
    shortTerm: [],
  },
  autoNewSessionOnIdle: false,
  autoNewSessionIdleHours: 6,
} as const;

function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/**
 * Clear preference keys used for default model / variants (session-scoped keys included).
 */
function clearModelPreferenceKeys() {
  safeRemove(MODEL_PREF_KEY);
  safeRemove(THINKING_PREF_KEY);
  safeRemove(VARIANT_PREF_KEY);
  try {
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      if (
        key === SESSION_MODEL_PREF_KEY ||
        key.startsWith(`${SESSION_MODEL_PREF_KEY}.`) ||
        key.startsWith(`${VARIANT_PREF_KEY}.`)
      ) {
        safeRemove(key);
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Reset onboarding + app preferences so the next launch shows /welcome.
 * Preserves language and theme keys.
 */
export function clearLocalStorageForOnboardingReset() {
  if (typeof window === "undefined") return;

  safeSet(PREFS_STORAGE_KEY, JSON.stringify(RESET_ONBOARDING_PREFS));
  safeRemove(UI_STORAGE_KEY);
  clearModelPreferenceKeys();

  for (const key of ONBOARDING_MARKER_KEYS) {
    safeRemove(key);
  }

  // Personal local agent ephemeral prefs (models / chat state) — part of "偏好"
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("onmyagent.personalLocalAgent.")) {
        safeRemove(key);
      }
    }
  } catch {
    // ignore
  }

  // Account avatar (color / emoji) is product preference, reset with onboarding.
  safeRemove("onmyagent.account.avatar");
}

export function clearLocalStorageForOnMyAgentReset(mode: ResetLocalStorageMode) {
  if (typeof window === "undefined") return;
  try {
    if (mode === "all") {
      window.localStorage.clear();
      return;
    }
    clearLocalStorageForOnboardingReset();
  } catch {
    // ignore persistence failures
  }
}

/**
 * After onboarding reset, re-enter the guide without killing the Electron process.
 *
 * Desktop dev is started by `electron-dev` (Vite parent + Electron child).
 * `app.relaunch()` restarts only Electron (PPID → 1), so `http://localhost:5173`
 * is gone and the window goes white. Soft reload keeps Vite alive and re-reads
 * localStorage into LocalProvider.
 *
 * Desktop uses HashRouter — must set `#/welcome` before reload.
 */
export function softReenterWelcomeGuide() {
  if (typeof window === "undefined") return;
  try {
    window.location.hash = "#/welcome";
  } catch {
    // ignore
  }
  try {
    window.location.reload();
  } catch {
    // ignore
  }
}
