/** @jsxImportSource react */
import { useEffect, useRef } from "react";

import { t } from "@/i18n";
import { desktopBridge } from "../../../app/lib/desktop";
import {
  computerUseActivityTransition,
  computerUsePermissionTransition,
  type ComputerUseActivityPhase,
  type ComputerUsePermissionState,
} from "./computer-use-activity-notifications";
import type { AppStatusToastInput } from "./status-toasts";

type ComputerUseStatusMonitorProps = {
  showToast: (input: AppStatusToastInput) => string;
};

export function ComputerUseStatusMonitor(props: ComputerUseStatusMonitorProps) {
  const previousPhase = useRef<ComputerUseActivityPhase | undefined>(undefined);
  const showToastRef = useRef(props.showToast);
  const previousPermissions = useRef<ComputerUsePermissionState | undefined>(undefined);
  showToastRef.current = props.showToast;

  useEffect(() => {
    const subscribe = window.__ONMYAGENT_ELECTRON__?.computerUse?.onActivity;
    if (!subscribe) return;
    return subscribe((activity) => {
      const transition = computerUseActivityTransition(
        previousPhase.current,
        activity.phase,
      );
      previousPhase.current = activity.phase;
      if (!transition) return;

      if (transition === "paused") {
        showToastRef.current({
          title: t("settings.computer_use_notice_paused"),
          description: t("settings.computer_use_notice_paused_description"),
          tone: "warning",
          durationMs: 6_000,
        });
        return;
      }
      if (transition === "errored") {
        showToastRef.current({
          title: t("settings.computer_use_notice_error"),
          description: activity.reason ?? t("settings.computer_use_notice_error_description"),
          tone: "error",
          durationMs: 0,
        });
        return;
      }
      const titleKey = transition === "started"
        ? "settings.computer_use_notice_started"
        : transition === "resumed"
          ? "settings.computer_use_notice_resumed"
          : "settings.computer_use_notice_finished";
      showToastRef.current({
        title: t(titleKey),
        description: activity.app ?? null,
        tone: transition === "resumed" ? "success" : "info",
        durationMs: 4_000,
      });
    });
  }, []);

  useEffect(() => {
    if (!window.__ONMYAGENT_ELECTRON__?.invokeDesktop) return;
    let disposed = false;
    const checkPermissions = async () => {
      try {
        const value = await desktopBridge.checkComputerUsePermissions();
        if (disposed || typeof value !== "object" || value === null) return;
        const current = {
          accessibility:
            "accessibility" in value && value.accessibility === true,
          screenRecording:
            "screenRecording" in value && value.screenRecording === true,
        };
        const lost = computerUsePermissionTransition(
          previousPermissions.current,
          current,
        );
        previousPermissions.current = current;
        if (lost) {
          showToastRef.current({
            title: t("settings.computer_use_notice_permission_lost"),
            description: t("settings.computer_use_notice_permission_lost_description"),
            tone: "error",
            durationMs: 0,
          });
        }
      } catch {
        // Runtime availability errors are reported by the activity channel and
        // settings health panel; focus checks only detect TCC transitions.
      }
    };
    const onFocus = () => void checkPermissions();
    window.addEventListener("focus", onFocus);
    void checkPermissions();
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
