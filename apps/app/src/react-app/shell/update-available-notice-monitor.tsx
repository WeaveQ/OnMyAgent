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
};

function electronUpdaterBridge() {
  if (typeof window === "undefined") return null;
  const desktop = (
    window as Window & {
      desktopBridge?: {
        updater?: {
          onAvailable?: (
            callback: (payload: UpdaterAvailablePayload) => void,
          ) => () => void;
          download?: () => Promise<{ ok: boolean; reason?: string }>;
        };
      };
    }
  ).desktopBridge;
  return desktop?.updater ?? null;
}

/**
 * Global home/session notice when main-process background check finds a new
 * version. Dedupe by release tag so the 5min/6h poller does not spam toasts.
 */
export function UpdateAvailableNoticeMonitor() {
  const { showToast } = useStatusToasts();
  const lastNotifiedVersionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    const bridge = electronUpdaterBridge();
    if (!bridge?.onAvailable) return;

    return bridge.onAvailable((payload) => {
      if (!payload?.available || !payload.latestVersion) return;
      const versionKey = String(payload.latestVersion).trim();
      if (!versionKey) return;
      if (lastNotifiedVersionRef.current === versionKey) return;
      lastNotifiedVersionRef.current = versionKey;

      showToast({
        tone: "info",
        title: t("settings.update_available_notice_title"),
        description: t("settings.update_available_notice_body", {
          version: versionKey,
        }),
        actionLabel: t("settings.update_available_notice_action"),
        onAction: () => {
          void bridge.download?.();
        },
        dismissLabel: t("common.dismiss"),
        // Stay until the user dismisses or acts — update is important.
        durationMs: 0,
      });
    });
  }, [showToast]);

  return null;
}
