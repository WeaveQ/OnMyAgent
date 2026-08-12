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
 * In-app (electron-updater) flow:
 *  - While downloading: a sticky, spinner toast tagged by version that updates
 *    its percentage / transferred bytes in place as `onDownloadProgress` fires.
 *    It is dismissible (×); if dismissed, progress ticks no longer recreate it.
 *  - When the download finishes: a higher-priority "更新已就绪" toast with a
 *    "重启并安装" action replaces it. This always shows — even if the user
 *    dismissed the progress toast — because it requires action.
 *  - On the open-browser fallback (dev/Linux) the availability toast keeps an
 *    action to kick off the manual flow.
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

    const showReadyToast = (versionKey: string) => {
      // Take down any in-progress download toast for this version.
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
          void bridge.installAndRestart?.();
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

    const showDownloadProgressToast = (
      versionKey: string,
      progress: UpdaterProgressPayload | null,
    ) => {
      if (dismissedProgressRef.current.has(versionKey)) return;
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
          if (!inApp) {
            // Fallback (dev/Linux): one-shot informational toast with an
            // action to open the release page / trigger manual download.
            if (lastAvailableVersionRef.current === versionKey) return;
            lastAvailableVersionRef.current = versionKey;
            showToast({
              tone: "info",
              title: t("settings.update_available_notice_title"),
              description: t("settings.update_available_notice_body", {
                version: versionKey,
              }),
              actionLabel: t("settings.open_release_page"),
              onAction: () => {
                void bridge.download?.();
              },
              dismissLabel: t("common.dismiss"),
              durationMs: 0,
            });
            return;
          }

          // In-app: show the live progress toast. If a progress event has
          // already arrived (races), its payload is included via the current
          // download state through subsequent onDownloadProgress ticks.
          showDownloadProgressToast(versionKey, null);
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
          if (payload.platformFlow === "in-app") {
            showDownloadProgressToast(versionKey, null);
          } else {
            if (lastAvailableVersionRef.current !== versionKey) {
              lastAvailableVersionRef.current = versionKey;
              showToast({
                tone: "info",
                title: t("settings.update_available_notice_title"),
                description: t("settings.update_available_notice_body", {
                  version: versionKey,
                }),
                actionLabel: t("settings.open_release_page"),
                onAction: () => {
                  void bridge.download?.();
                },
                dismissLabel: t("common.dismiss"),
                durationMs: 0,
              });
            }
          }
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
