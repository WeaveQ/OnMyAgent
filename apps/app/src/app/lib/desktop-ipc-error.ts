import { t } from "../../i18n";

/** Strip Electron's `Error invoking remote method '…': Error: ` wrapper. */
export function unwrapDesktopIpcError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  const match = text.match(
    /Error invoking remote method '[^']+': (?:Error:\s*)?([\s\S]+)$/i,
  );
  return (match?.[1] ?? text).trim();
}

function isSpawnHelperFailure(inner: string): boolean {
  return /posix_spawnp|spawn helper/i.test(inner);
}

function isDesktopHelperUnavailable(inner: string): boolean {
  return /not implemented yet|No handler registered|desktop helper is unavailable/i.test(
    inner,
  );
}

/**
 * User-facing desktop IPC copy. Always strips the Electron invoke wrapper.
 * Known native spawn / stale-bridge failures map to i18n; other inners stay.
 */
export function formatDesktopIpcError(raw: unknown): string {
  const inner = unwrapDesktopIpcError(raw);
  if (!inner) return t("system.desktop_ipc_failed");
  if (isSpawnHelperFailure(inner)) return t("system.desktop_spawn_failed");
  if (isDesktopHelperUnavailable(inner)) {
    return t("plugins.connector_ipc_restart_hint");
  }
  return inner;
}
