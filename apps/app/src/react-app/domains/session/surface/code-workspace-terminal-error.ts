import { unwrapDesktopIpcError } from "../../local-agents";
import { t } from "../../../../i18n";

export function formatCodeWorkspaceTerminalOpenError(raw: unknown): string {
  const inner = unwrapDesktopIpcError(raw);
  if (/posix_spawnp|spawn helper/i.test(inner)) {
    return t("session.code_side_panel_terminal_open_failed");
  }
  return inner || t("session.code_side_panel_terminal_open_failed");
}
