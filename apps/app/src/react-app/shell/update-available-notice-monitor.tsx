/** @jsxImportSource react */
import { useEffect, useRef } from "react";

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

function electronUpdaterBridge() {
  if (typeof window === "undefined") return null;
  return (
    window as Window & {
      __ONMYAGENT_ELECTRON__?: {
        updater?: {
          onAvailable?: (
            callback: (payload: UpdaterAvailablePayload) => void,
          ) => () => void;
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
      };
    }
  ).__ONMYAGENT_ELECTRON__?.updater ?? null;
}

/**
 * Global home/session notice when the main-process background check finds a
 * new version. For the in-app (electron-updater) flow a higher-priority toast
 * fires when the update is fully downloaded and ready to install; the
 * availability toast instead invites the user to view the download.
 * Dedupe by version so the 6h poller does not spam toasts.
 */
export function UpdateAvailableNoticeMonitor() {
  const { showToast } = useStatusToasts();
  const lastAvailableVersionRef = useRef<string | null>(null);
  const lastReadyVersionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    const bridge = electronUpdaterBridge();
    if (!bridge?.onAvailable) return;

    return bridge.onAvailable((payload) => {
      if (!payload?.latestVersion) return;
      const versionKey = String(payload.latestVersion).trim();
      if (!versionKey) return;

      if (payload.readyToInstall) {
        if (lastReadyVersionRef.current === versionKey) return;
        lastReadyVersionRef.current = versionKey;
        showToast({
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
        });
        return;
      }

      if (!payload.available) return;
      if (lastAvailableVersionRef.current === versionKey) return;
      lastAvailableVersionRef.current = versionKey;

      const inApp = payload.platformFlow === "in-app";
      showToast({
        tone: "info",
        title: t("settings.update_available_notice_title"),
        description: inApp
          ? t("settings.update_downloading_notice_body", {
              version: versionKey,
            })
          : t("settings.update_available_notice_body", {
              version: versionKey,
            }),
        actionLabel: inApp
          ? t("settings.open_release_page")
          : t("settings.update_available_notice_action"),
        onAction: () => {
          if (inApp) {
            // The download is already running in the background; open the
            // release page for release notes as a non-destructive side action.
            void bridge.download?.();
          } else {
            void bridge.download?.();
          }
        },
        dismissLabel: t("common.dismiss"),
        durationMs: 0,
      });
    });
  }, [showToast]);

  return null;
}
