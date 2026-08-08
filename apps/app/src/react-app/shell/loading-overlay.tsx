/** @jsxImportSource react */
import { useState } from "react";
import { Button } from "@/components/ui/button";

import { t } from "../../i18n";
import {
  desktopBridge,
  openDesktopUrl,
  relaunchDesktopApp,
} from "../../app/lib/desktop";
import { isElectronRuntime } from "../../app/utils";
import { useBootState, useBootOverlayVisible } from "./boot-state";
import { LoadSurface, useRouteLoadTop } from "./load-surface";

const RELEASES_URL = "https://github.com/WeaveQ/onmyagent/releases";

const errorClass = {
  wrap: "flex flex-col gap-3 text-xs leading-5 text-dls-status-danger-fg",
  secondary: "text-dls-secondary",
  link: "text-dls-accent underline decoration-dls-accent/40 underline-offset-4",
  actions: "flex flex-wrap items-center justify-center gap-2",
  status: "text-center text-2xs leading-4 text-dls-secondary",
};

function relaunchOrReload() {
  if (isElectronRuntime()) {
    void relaunchDesktopApp().catch(() => {
      window.location.reload();
    });
    return;
  }
  window.location.reload();
}

/**
 * Full-screen boot overlay: solid background, brand mark, clear phase copy.
 * Never translucent — empty shell must not bleed through.
 * Fades once both the boot hook and the first route load are ready.
 */
export function LoadingOverlay() {
  const visible = useBootOverlayVisible();
  const { phase, message, error, detail } = useBootState();
  const { top, detail: routeDetail, busy: routeBusy } = useRouteLoadTop();
  const [repairStatus, setRepairStatus] = useState<
    "idle" | "working" | "done" | "failed"
  >("idle");
  const [busyAction, setBusyAction] = useState<"open" | "repair" | null>(null);

  if (!visible) return null;

  const fading = phase === "ready" && !error;
  // Prefer specific route load copy when something is actively loading under the overlay.
  const displayMessage =
    routeBusy && top
      ? t(top.messageKey ?? "system.boot_preparing_workspace") +
        (routeDetail?.trim() ? ` · ${routeDetail.trim()}` : "")
      : message || t("system.boot_preparing_workspace");

  const desktop = isElectronRuntime();

  const onOpenConfigDir = async () => {
    if (!desktop) return;
    setBusyAction("open");
    try {
      await desktopBridge.openOpenCodeConfigDir();
    } catch (e) {
      console.warn("[boot] openOpenCodeConfigDir failed", e);
    } finally {
      setBusyAction(null);
    }
  };

  const onRepairConfig = async () => {
    if (!desktop) return;
    setBusyAction("repair");
    setRepairStatus("working");
    try {
      const result = (await desktopBridge.repairOpenCodeEngineConfig(
        {},
      )) as { ok?: boolean } | null | undefined;
      if (result?.ok) {
        setRepairStatus("done");
      } else {
        setRepairStatus("failed");
      }
    } catch (e) {
      console.warn("[boot] repairOpenCodeEngineConfig failed", e);
      setRepairStatus("failed");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <LoadSurface variant="full" fading={fading} message={displayMessage}>
      {error ? (
        <div className={errorClass.wrap}>
          <div className="text-sm font-medium">{error}</div>
          <div className={errorClass.actions}>
            <Button
              type="button"
              size="sm"
              onClick={() => relaunchOrReload()}
            >
              {t("system.boot_retry")}
            </Button>
            {desktop ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyAction !== null}
                  onClick={() => void onRepairConfig()}
                >
                  {busyAction === "repair"
                    ? t("system.boot_repair_working")
                    : t("system.boot_repair_config")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busyAction !== null}
                  onClick={() => void onOpenConfigDir()}
                >
                  {t("system.boot_open_config_dir")}
                </Button>
              </>
            ) : null}
          </div>
          {repairStatus === "done" ? (
            <div className={errorClass.status}>{t("system.boot_repair_done")}</div>
          ) : null}
          {repairStatus === "failed" ? (
            <div className={errorClass.status}>
              {t("system.boot_repair_failed")}
            </div>
          ) : null}
          {detail?.trim() ? (
            <details className="mx-auto max-w-md text-left text-2xs text-dls-secondary">
              <summary className="cursor-pointer select-none">
                technical
              </summary>
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-dls-surface-muted p-2 text-2xs leading-4 text-dls-secondary">
                {detail.trim()}
              </pre>
            </details>
          ) : null}
          <div className={errorClass.secondary}>
            {t("system.boot_download_latest_hint")}{" "}
            <button
              type="button"
              className={errorClass.link}
              onClick={() => void openDesktopUrl(RELEASES_URL)}
            >
              {RELEASES_URL}
            </button>
          </div>
        </div>
      ) : null}
    </LoadSurface>
  );
}
