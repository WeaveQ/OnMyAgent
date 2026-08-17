/** @jsxImportSource react */
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

import { t } from "@/i18n";
import { isElectronRuntime } from "../../app/utils";
import { useStatusToasts } from "../domains/shell-feedback";

type UpdaterAvailablePayload = {
  available?: boolean;
  currentVersion?: string;
  latestVersion?: string | null;
  releaseUrl?: string | null;
  platformFlow?: "in-app" | "open-browser";
  readyToInstall?: boolean;
};

type UpdaterProgressPayload = {
  state?: "downloading" | "ready" | "error";
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  readyToInstall?: boolean;
};

type UpdaterBridge = {
  onAvailable?: (
    callback: (payload: UpdaterAvailablePayload) => void,
  ) => () => void;
  onDownloadProgress?: (
    callback: (payload: UpdaterProgressPayload) => void,
  ) => () => void;
  getLastKnown?: () => Promise<UpdaterAvailablePayload>;
  download?: () => Promise<{
    ok: boolean;
    reason?: string;
    downloading?: boolean;
    readyToInstall?: boolean;
  }>;
  installAndRestart?: () => Promise<{
    ok: boolean;
    reason?: string;
  }>;
};

function electronUpdaterBridge(): UpdaterBridge | null {
  if (typeof window === "undefined") return null;
  return (
    window as Window & {
      __ONMYAGENT_ELECTRON__?: {
        updater?: UpdaterBridge;
      };
    }
  ).__ONMYAGENT_ELECTRON__?.updater ?? null;
}

function formatBytes(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Global home/session notice when the main-process background check finds a
 * new version.
 *
 * Availability: a sticky toast with a download / open-release action.
 *  - Click starts `bridge.download()` (in-app package, or GitHub in fallback).
 *  - While downloading: a spinner toast tagged by version; progress ticks
 *    update it in place. Dismissible (×); dismissed versions stay quiet.
 *  - When the download finishes: a "更新已就绪" toast with "重启并安装".
 *
 * On mount we also ask the main process for the last known state so an update
 * that was detected (or finished downloading) before the renderer mounted — or
 * in a previous session — still surfaces the appropriate toast.
 *
 * Dedupe by version so the 6h poller does not spam toasts.
 */
export function UpdateAvailableNoticeMonitor() {
  const { showToast, dismissToast } = useStatusToasts();
  const lastAvailableVersionRef = useRef<string | null>(null);
  const lastReadyVersionRef = useRef<string | null>(null);
  /** Versions whose progress toast the user manually dismissed. */
  const dismissedProgressRef = useRef<Set<string>>(new Set());
  /** Tag → toast id for the in-place progress toast, keyed by version. */
  const progressToastTagRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    const bridge = electronUpdaterBridge();
    if (!bridge) return;

    const progressTagFor = (versionKey: string) =>
      `updater-download:${versionKey}`;

    // The store resolves in-place updates by tag, but it does not expose
    // tag-based dismissal. Track the toast id we last showed for the active
    // download so we can take it down when the update becomes ready.
    const progressToastIdRef = { current: null as string | null };
    const readyToastIdRef = { current: null as string | null };
    const availableToastIdRef = { current: null as string | null };
    const installingRef = { current: false };
    /** True while we dismiss a toast ourselves (ready ↔ progress swap). */
    const programmaticDismissRef = { current: false };
    const dismissProgressToast = (versionKey: string) => {
      const tag = progressTagFor(versionKey);
      if (progressToastTagRef.current === tag && progressToastIdRef.current) {
        programmaticDismissRef.current = true;
        try {
          dismissToast(progressToastIdRef.current);
        } finally {
          programmaticDismissRef.current = false;
        }
        progressToastIdRef.current = null;
        progressToastTagRef.current = null;
      }
    };
    const dismissReadyToast = () => {
      if (readyToastIdRef.current) {
        programmaticDismissRef.current = true;
        try {
          dismissToast(readyToastIdRef.current);
        } finally {
          programmaticDismissRef.current = false;
        }
        readyToastIdRef.current = null;
      }
    };
    const dismissAvailableToast = () => {
      if (availableToastIdRef.current) {
        programmaticDismissRef.current = true;
        try {
          dismissToast(availableToastIdRef.current);
        } finally {
          programmaticDismissRef.current = false;
        }
        availableToastIdRef.current = null;
      }
    };

    const showInstallingToast = (versionKey: string) => {
      dismissAvailableToast();
      dismissProgressToast(versionKey);
      dismissReadyToast();
      readyToastIdRef.current = showToast({
        tone: "info",
        tag: `updater-installing:${versionKey}`,
        icon: Loader2,
        spinIcon: true,
        title: t("settings.update_installing_notice_title"),
        description: t("settings.update_installing_notice_body", {
          version: versionKey,
        }),
        durationMs: 0,
        onDismiss: () => {
          readyToastIdRef.current = null;
        },
      });
    };

    const showReadyToast = (versionKey: string) => {
      if (installingRef.current) return;
      // Take down any in-progress download toast for this version.
      dismissAvailableToast();
      dismissProgressToast(versionKey);
      // Keep the version key so onDownloadProgress can still route if a
      // cache-miss re-download starts after a seeded "ready" state.
      lastAvailableVersionRef.current = versionKey;
      if (lastReadyVersionRef.current === versionKey) return;
      lastReadyVersionRef.current = versionKey;
      readyToastIdRef.current = showToast({
        tone: "info",
        title: t("settings.update_ready_notice_title"),
        description: t("settings.update_ready_notice_body", {
          version: versionKey,
        }),
        actionLabel: t("settings.restart_and_install"),
        onAction: () => {
          if (installingRef.current) return;
          installingRef.current = true;
          showInstallingToast(versionKey);
          void bridge.installAndRestart?.().then((result) => {
            if (result && result.ok === false) {
              installingRef.current = false;
              lastReadyVersionRef.current = null;
              showReadyToast(versionKey);
            }
          });
        },
        dismissLabel: t("common.dismiss"),
        durationMs: 0,
        onDismiss: () => {
          readyToastIdRef.current = null;
        },
      });
    };

    const progressDescription = (
      versionKey: string,
      progress: UpdaterProgressPayload | null,
    ) => {
      const percent =
        typeof progress?.percent === "number"
          ? Math.max(0, Math.min(100, Math.round(progress.percent)))
          : 0;
      const transferred = formatBytes(progress?.transferred);
      const total = formatBytes(progress?.total);
      if (transferred && total) {
        return t("settings.update_download_progress_notice_body_bytes", {
          version: versionKey,
          percent,
          transferred,
          total,
        });
      }
      return t("settings.update_download_progress_notice_body", {
        version: versionKey,
        percent,
      });
    };

    const showAvailableToast = (versionKey: string, inApp: boolean) => {
      if (installingRef.current) return;
      if (progressToastIdRef.current) return;
      if (lastReadyVersionRef.current === versionKey) return;
      if (availableToastIdRef.current) return;
      lastAvailableVersionRef.current = versionKey;
      availableToastIdRef.current = showToast({
        tone: "info",
        tag: `updater-available:${versionKey}`,
        title: t("settings.update_available_notice_title"),
        description: t("settings.update_available_notice_body", {
          version: versionKey,
        }),
        actionLabel: inApp
          ? t("settings.download_update")
          : t("settings.open_release_page"),
        onAction: () => {
          dismissAvailableToast();
          void bridge.download?.();
        },
        dismissLabel: t("common.dismiss"),
        durationMs: 0,
        onDismiss: () => {
          availableToastIdRef.current = null;
        },
      });
    };

    const showDownloadProgressToast = (
      versionKey: string,
      progress: UpdaterProgressPayload | null,
    ) => {
      if (dismissedProgressRef.current.has(versionKey)) return;
      dismissAvailableToast();
      lastAvailableVersionRef.current = versionKey;
      const tag = progressTagFor(versionKey);
      progressToastTagRef.current = tag;
      const id = showToast({
        tone: "info",
        tag,
        icon: Loader2,
        spinIcon: true,
        title: t("settings.update_downloading_notice_title", {
          version: versionKey,
        }),
        description: progressDescription(versionKey, progress),
        durationMs: 0,
        onDismiss: () => {
          progressToastIdRef.current = null;
          if (progressToastTagRef.current === tag) {
            progressToastTagRef.current = null;
          }
          // Only treat × / secondary dismiss as user intent. Programmatic
          // replace (progress → ready) must not suppress future progress.
          if (!programmaticDismissRef.current) {
            dismissedProgressRef.current.add(versionKey);
          }
        },
      });
      progressToastIdRef.current = id;
    };

    const updateDownloadProgress = (
      versionKey: string,
      progress: UpdaterProgressPayload,
    ) => {
      if (progress.state === "ready" || progress.readyToInstall) {
        showReadyToast(versionKey);
        return;
      }
      if (dismissedProgressRef.current.has(versionKey)) return;
      if (progress.state === "error") return;
      // A real download tick after a seeded ready means the cache missed —
      // drop the stale ready toast and allow it to reappear when finished.
      if (lastReadyVersionRef.current === versionKey) {
        lastReadyVersionRef.current = null;
        dismissReadyToast();
        dismissedProgressRef.current.delete(versionKey);
      }
      // showToast merges in place under the stable tag, so repeated progress
      // ticks just update the text/spinner of the existing card.
      showDownloadProgressToast(versionKey, progress);
    };

    // ---- Main-process event subscriptions ---------------------------------

    const unsubscribers: Array<() => void> = [];

    if (bridge.onDownloadProgress) {
      unsubscribers.push(
        bridge.onDownloadProgress((progress) => {
          const versionKey = lastAvailableVersionRef.current;
          if (!versionKey) return;
          updateDownloadProgress(versionKey, progress);
        }),
      );
    }

    if (bridge.onAvailable) {
      unsubscribers.push(
        bridge.onAvailable((payload) => {
          if (!payload?.latestVersion) return;
          const versionKey = String(payload.latestVersion).trim();
          if (!versionKey) return;

          if (payload.readyToInstall) {
            showReadyToast(versionKey);
            return;
          }

          if (!payload.available) return;

          const inApp = payload.platformFlow === "in-app";
          showAvailableToast(versionKey, inApp);
        }),
      );
    }

    // ---- Startup / relaunch catch-up --------------------------------------
    // Surface update state the main process already reached before this
    // renderer mounted (update-available fired during startup before the
    // listener attached, or an update downloaded in a prior launch).
    if (bridge.getLastKnown) {
      void bridge.getLastKnown().then((payload) => {
        if (!payload?.latestVersion) return;
        const versionKey = String(payload.latestVersion).trim();
        if (!versionKey) return;
        if (payload.readyToInstall) {
          showReadyToast(versionKey);
        } else if (payload.available) {
          showAvailableToast(versionKey, payload.platformFlow === "in-app");
        }
      });
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [showToast, dismissToast]);

  return null;
}
