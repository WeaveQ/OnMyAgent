/** @jsxImportSource react */
import { useBootState, useBootOverlayVisible } from "./boot-state";
import { OwDotTicker } from "./dot-ticker";
import { t } from "../../i18n";

const RELEASES_URL = "https://github.com/WeaveQ/onmyagent/releases";

const loadingOverlayClass = {
  shell: "fixed inset-0 z-[1000] flex items-center justify-center bg-dls-surface transition-opacity duration-[160ms]",
  visible: "pointer-events-auto opacity-100",
  fading: "pointer-events-none opacity-0",
  content: "flex w-full max-w-[320px] flex-col items-center gap-4 px-6 text-center",
  message: "text-xs leading-5 text-dls-secondary",
  error: "flex flex-col gap-2 text-xs leading-5 text-dls-status-danger-fg",
  secondary: "text-dls-secondary",
  link: "text-dls-accent underline decoration-dls-accent/40 underline-offset-4",
};

/**
 * Quiet, opaque boot overlay. Solid surface fill so nothing bleeds through.
 * A minimal typographic beat plus a small dot ticker. Fades once both the
 * boot hook and the first route load are ready.
 */
export function LoadingOverlay() {
  const visible = useBootOverlayVisible();
  const { phase, message, error } = useBootState();

  if (!visible) return null;

  const fading = phase === "ready";

  return (
    <div
      className={`${loadingOverlayClass.shell} ${
        fading ? loadingOverlayClass.fading : loadingOverlayClass.visible
      }`}
      aria-live="polite"
      aria-busy={!fading}
      role="status"
    >
      <div className={loadingOverlayClass.content}>
        <OwDotTicker size="md" />
        <div className={loadingOverlayClass.message}>
          {message || t("system.boot_preparing_workspace")}
        </div>
        {error ? (
          <div className={loadingOverlayClass.error}>
            <div>{error}</div>
            <div className={loadingOverlayClass.secondary}>
              Download the latest version manually here:{" "}
              <a
                href={RELEASES_URL}
                target="_blank"
                rel="noreferrer"
                className={loadingOverlayClass.link}
              >
                {RELEASES_URL}
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
