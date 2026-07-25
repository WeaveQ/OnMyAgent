/** @jsxImportSource react */
import { Button } from "@/components/ui/button";

import { t } from "../../i18n";
import { relaunchDesktopApp } from "../../app/lib/desktop";
import { isElectronRuntime } from "../../app/utils";
import { useBootState, useBootOverlayVisible } from "./boot-state";
import { LoadSurface, useRouteLoadTop } from "./load-surface";

const RELEASES_URL = "https://github.com/WeaveQ/onmyagent/releases";

const errorClass = {
  wrap: "flex flex-col gap-3 text-xs leading-5 text-dls-status-danger-fg",
  secondary: "text-dls-secondary",
  link: "text-dls-accent underline decoration-dls-accent/40 underline-offset-4",
  actions: "flex flex-wrap items-center justify-center gap-2",
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
 * Quiet, opaque boot overlay. Solid surface fill so nothing bleeds through.
 * Message prefers active route-load registry scopes, then boot phase copy.
 * Fades once both the boot hook and the first route load are ready.
 */
export function LoadingOverlay() {
  const visible = useBootOverlayVisible();
  const { phase, message, error } = useBootState();
  const { top, detail, busy: routeBusy } = useRouteLoadTop();

  if (!visible) return null;

  const fading = phase === "ready";
  // Prefer specific route load copy when something is actively loading under the overlay.
  const displayMessage =
    routeBusy && top
      ? t(top.messageKey ?? "system.boot_preparing_workspace") +
        (detail?.trim() ? ` · ${detail.trim()}` : "")
      : message || t("system.boot_preparing_workspace");

  return (
    <LoadSurface variant="full" fading={fading} message={displayMessage}>
      {error ? (
        <div className={errorClass.wrap}>
          <div>{error}</div>
          <div className={errorClass.actions}>
            <Button
              type="button"
              size="sm"
              onClick={() => relaunchOrReload()}
            >
              {t("system.boot_retry")}
            </Button>
          </div>
          <div className={errorClass.secondary}>
            {t("system.boot_download_latest_hint")}{" "}
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className={errorClass.link}
            >
              {RELEASES_URL}
            </a>
          </div>
        </div>
      ) : null}
    </LoadSurface>
  );
}
