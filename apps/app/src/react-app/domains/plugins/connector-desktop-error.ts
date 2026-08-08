import { t } from "@/i18n";

/**
 * Map desktop IPC / bridge failures to user-facing copy.
 * Stale main process (not fully restarted after adding handlers) often surfaces as
 * "Error invoking remote method" — not a bad token.
 */
export function isDesktopIpcUnavailableError(raw: string): boolean {
  return /Error invoking remote method|not implemented yet|desktop helper is unavailable|No handler registered/i.test(
    String(raw ?? ""),
  );
}

function isIpcRestartCopy(text: string): boolean {
  if (isDesktopIpcUnavailableError(text)) return true;
  // Already-localized full restart hint (stored on status.errorMessage).
  return (
    text.includes("完全退出") ||
    text.includes("Fully quit") ||
    text.includes("主程序未載入") ||
    text.includes("main process is missing")
  );
}

/**
 * Full message for dialogs / tooltips.
 * @param raw thrown message or status.errorMessage
 * @param productFallback product-specific hint (token/network etc.)
 */
export function formatDesktopConnectorError(
  raw: string | null | undefined,
  productFallback: string,
): string {
  const text = String(raw ?? "").trim();
  if (!text) return productFallback;
  if (isIpcRestartCopy(text)) {
    return t("plugins.connector_ipc_restart_hint");
  }
  return text;
}

/**
 * Single-line copy for fixed-height connector tiles (no NoticeBox).
 */
export function formatDesktopConnectorErrorShort(
  raw: string | null | undefined,
  productFallback: string,
): string {
  const text = String(raw ?? "").trim();
  if (!text) return productFallback;
  if (isIpcRestartCopy(text)) {
    return t("plugins.connector_ipc_restart_short");
  }
  // Keep card quiet: long product errors collapse to a short line.
  if (text.length > 16) {
    return t("plugins.connector_error_short");
  }
  return text;
}
