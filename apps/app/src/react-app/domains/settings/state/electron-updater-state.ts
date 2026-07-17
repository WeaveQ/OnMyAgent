/** @jsxImportSource react */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { DenDesktopConfig } from "../../../../app/lib/den";
import { isAlphaUpdateAllowed } from "../../../../app/lib/version-gate";
import type { ReleaseChannel } from "../../../../app/types";
import { isElectronRuntime, safeStringify } from "../../../../app/utils";
import { t } from "../../../../i18n";

export type SettingsUpdateStatus = {
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  lastCheckedAt?: number | null;
  version?: string;
  date?: string;
  notes?: string;
  totalBytes?: number | null;
  downloadedBytes?: number;
  message?: string;
} | null;

type UpdateAvailabilityPayload = {
  available?: boolean;
  currentVersion?: string;
  latestVersion?: string | null;
  releaseDate?: string | null;
  releaseNotes?: unknown;
  reason?: string | null;
};

type ElectronUpdaterBridge = NonNullable<Window["__ONMYAGENT_ELECTRON__"]>["updater"] & {
  onDownloadProgress?: (callback: (data: {
    transferred: number;
    total: number;
    percent: number;
    bytesPerSecond: number;
  }) => void) => (() => void);
  onAvailable?: (callback: (payload: UpdateAvailabilityPayload) => void) => (() => void);
  getLastKnown?: () => Promise<UpdateAvailabilityPayload>;
};

type UseElectronUpdaterStateOptions = {
  releaseChannel: ReleaseChannel;
  onReleaseChannelChange: (next: ReleaseChannel) => void;
  updateAutoCheck: boolean;
  /** @deprecated Lightweight updater never auto-downloads; kept for call-site compat. */
  updateAutoDownload: boolean;
  desktopConfig: DenDesktopConfig | null | undefined;
  setError: (message: string | null) => void;
};

type ElectronUpdaterEnvState = {
  appVersion: string | null;
  updateEnv: { supported?: boolean; reason?: string | null } | null;
  /** Main process reports whether alpha feed exists (currently always false). */
  alphaSupported: boolean;
};

type ElectronUpdaterEnvAction =
  | { type: "app-version"; appVersion: string | null }
  | { type: "unsupported"; reason: string }
  | { type: "alpha-supported"; alphaSupported: boolean };

function electronUpdaterEnvReducer(
  state: ElectronUpdaterEnvState,
  action: ElectronUpdaterEnvAction,
): ElectronUpdaterEnvState {
  switch (action.type) {
    case "app-version":
      return { ...state, appVersion: action.appVersion };
    case "unsupported":
      return {
        ...state,
        updateEnv: { supported: false, reason: action.reason },
      };
    case "alpha-supported":
      return { ...state, alphaSupported: action.alphaSupported };
  }
}

function electronUpdaterBridge(): ElectronUpdaterBridge | null {
  if (typeof window === "undefined") return null;
  return window.__ONMYAGENT_ELECTRON__?.updater ?? null;
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  const serialized = safeStringify(error);
  return serialized && serialized !== "{}" ? serialized : String(error);
}

function releaseNotesToText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "note" in entry) {
          const note = String((entry as { note?: unknown }).note ?? "");
          return note ? [note] : [];
        }
        return [];
      })
      .join("\n\n") || undefined;
  }
  return undefined;
}

function statusFromAvailability(
  result: UpdateAvailabilityPayload,
  availableAllowed: boolean,
): Exclude<SettingsUpdateStatus, null> {
  if (result.reason && !result.available && !result.latestVersion) {
    // Soft "no releases yet" stays idle; hard network failures are errors.
    const soft =
      /no release/i.test(result.reason) ||
      /not been published/i.test(result.reason);
    if (!soft) {
      return {
        state: "error",
        lastCheckedAt: Date.now(),
        message: result.reason,
      };
    }
  }
  return availableAllowed
    ? {
        state: "available",
        lastCheckedAt: Date.now(),
        version: result.latestVersion ?? undefined,
        date: result.releaseDate ?? undefined,
        notes: releaseNotesToText(result.releaseNotes),
      }
    : {
        state: "idle",
        lastCheckedAt: Date.now(),
        version: result.latestVersion ?? undefined,
        date: result.releaseDate ?? undefined,
        notes: releaseNotesToText(result.releaseNotes),
      };
}

export function useElectronUpdaterState(options: UseElectronUpdaterStateOptions) {
  const {
    releaseChannel,
    onReleaseChannelChange,
    updateAutoCheck,
    desktopConfig,
    setError,
  } = options;
  const [updateStatus, setUpdateStatus] = useState<SettingsUpdateStatus>(null);
  const [envState, dispatchEnvState] = useReducer(electronUpdaterEnvReducer, {
    appVersion: null,
    updateEnv: null,
    alphaSupported: false,
  });
  const { appVersion, updateEnv, alphaSupported } = envState;
  const autoCheckKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    const bridge = electronUpdaterBridge();
    if (!bridge?.getChannel) {
      dispatchEnvState({ type: "unsupported", reason: "Electron updater bridge is unavailable." });
      return;
    }
    let cancelled = false;
    void bridge
      .getChannel()
      .then(async (state) => {
        if (cancelled) return;
        dispatchEnvState({ type: "app-version", appVersion: state.currentVersion ?? null });
        const alphaOk =
          typeof (state as { alphaSupported?: boolean }).alphaSupported === "boolean"
            ? Boolean((state as { alphaSupported?: boolean }).alphaSupported)
            : false;
        dispatchEnvState({ type: "alpha-supported", alphaSupported: alphaOk });

        // Snap prefs to the channel the main process actually serves.
        if (state.channel && state.channel !== releaseChannel) {
          onReleaseChannelChange(state.channel);
        }
        if (!alphaOk && releaseChannel === "alpha") {
          onReleaseChannelChange("stable");
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatchEnvState({ type: "unsupported", reason: "Electron updater bridge is unavailable." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onReleaseChannelChange, releaseChannel]);

  // Keep Settings in sync with background main-process checks (OS notify path).
  useEffect(() => {
    if (!isElectronRuntime()) return;
    const bridge = electronUpdaterBridge();
    if (!bridge?.onAvailable) return;
    return bridge.onAvailable((payload) => {
      if (payload.currentVersion) {
        dispatchEnvState({ type: "app-version", appVersion: payload.currentVersion });
      }
      if (!payload.available) return;
      void (async () => {
        // Stable feed is trusted from main; only alpha would need Den gating
        // (and alpha is currently unsupported).
        const allowed =
          releaseChannel === "alpha" && payload.latestVersion
            ? await isAlphaUpdateAllowed(payload.latestVersion, desktopConfig)
            : Boolean(payload.available && payload.latestVersion);
        setUpdateStatus(statusFromAvailability(payload, allowed));
      })();
    });
  }, [desktopConfig, releaseChannel]);

  /**
   * Open the GitHub release page in the browser. Does not download or install.
   * Status stays on "available" (never "ready") so we don't imply an install finished.
   */
  const downloadUpdate = useCallback(async () => {
    const bridge = electronUpdaterBridge();
    if (!bridge?.download) {
      const message = "Opening the release page is only available in the Electron desktop app.";
      setUpdateStatus({ state: "error", message });
      setError(message);
      return;
    }
    try {
      const result = await bridge.download();
      if (!result?.ok) {
        setUpdateStatus({
          state: "error",
          message: result?.reason ?? "Failed to open the release page.",
        });
        return;
      }
      // Stay on available — browser open is not an install.
      setUpdateStatus((current) => ({
        ...(current ?? {}),
        state: "available",
        message: undefined,
      }));
    } catch (error) {
      setUpdateStatus({ state: "error", message: describeError(error) });
    }
  }, [setError]);

  const checkForUpdates = useCallback(async () => {
    const bridge = electronUpdaterBridge();
    if (!bridge?.check) {
      const message = "Electron update checks are available only in the Electron desktop app.";
      setUpdateStatus({ state: "error", message });
      setError(message);
      return;
    }

    setUpdateStatus({ state: "checking" });
    try {
      const result = await bridge.check("stable");
      dispatchEnvState({ type: "app-version", appVersion: result.currentVersion ?? null });
      if (result.channel && result.channel !== releaseChannel) {
        onReleaseChannelChange(result.channel);
      }
      if (result.reason === "unavailable") {
        setUpdateStatus({
          state: "idle",
          message: t("settings.auto_updates_packaged_only"),
        });
        return;
      }

      // Stable: trust the main-process GitHub comparison (no Den allow-list).
      // Alpha would still go through Den if re-enabled later.
      const checkedReleaseChannel = result.channel ?? "stable";
      const availableAllowed =
        result.available && result.latestVersion
          ? checkedReleaseChannel === "alpha"
            ? await isAlphaUpdateAllowed(result.latestVersion, desktopConfig)
            : true
          : false;

      if (result.reason && !result.available && !result.latestVersion) {
        const soft =
          /no release/i.test(result.reason) ||
          /not been published/i.test(result.reason);
        setUpdateStatus(
          soft
            ? { state: "idle", lastCheckedAt: Date.now(), message: result.reason }
            : { state: "error", lastCheckedAt: Date.now(), message: result.reason },
        );
        return;
      }

      setUpdateStatus(statusFromAvailability(result, availableAllowed));
      // Intentionally do NOT auto-open the browser when prefs say "auto download".
      // The lightweight updater has no in-app download path.
    } catch (error) {
      setUpdateStatus({ state: "error", message: describeError(error) });
    }
  }, [desktopConfig, onReleaseChannelChange, releaseChannel, setError]);

  // Optional renderer-side check when the user enables background checks.
  // Main process also polls and owns OS notifications; this only refreshes Settings state.
  useEffect(() => {
    if (!updateAutoCheck || updateEnv?.supported === false) return;
    const key = `${releaseChannel}:${appVersion ?? "unknown"}`;
    if (autoCheckKeyRef.current === key) return;
    autoCheckKeyRef.current = key;
    void checkForUpdates();
  }, [appVersion, checkForUpdates, releaseChannel, updateAutoCheck, updateEnv?.supported]);

  const installUpdateAndRestart = useCallback(async () => {
    // Same as open release page — there is no in-app install.
    await downloadUpdate();
  }, [downloadUpdate]);

  const setReleaseChannel = useCallback(
    async (next: ReleaseChannel) => {
      const bridge = electronUpdaterBridge();
      if (!bridge?.setChannel) {
        onReleaseChannelChange(next);
        return;
      }
      try {
        const state = await bridge.setChannel(next);
        dispatchEnvState({ type: "app-version", appVersion: state.currentVersion ?? null });
        const alphaOk =
          typeof (state as { alphaSupported?: boolean }).alphaSupported === "boolean"
            ? Boolean((state as { alphaSupported?: boolean }).alphaSupported)
            : false;
        dispatchEnvState({ type: "alpha-supported", alphaSupported: alphaOk });
        // Prefer the channel main actually serves (always stable today).
        const applied = state.channel ?? "stable";
        onReleaseChannelChange(applied);
        if (applied !== next && (state as { reason?: string }).reason) {
          setUpdateStatus({
            state: "idle",
            message: String((state as { reason?: string }).reason),
          });
        }
        await checkForUpdates();
      } catch (error) {
        setUpdateStatus({ state: "error", message: describeError(error) });
      }
    },
    [checkForUpdates, onReleaseChannelChange],
  );

  return {
    appVersion,
    updateEnv,
    updateStatus,
    alphaSupported,
    checkForUpdates,
    downloadUpdate,
    installUpdateAndRestart,
    setReleaseChannel,
  };
}
