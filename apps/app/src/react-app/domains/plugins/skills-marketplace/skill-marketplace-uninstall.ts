/**
 * Overflow uninstall visibility and backend for marketplace "Mine" cards.
 * Built-in stays read-only. User-installed and Local share the same 卸载 item.
 */

export function skillOverflowShowsUninstall(input: {
  originBuiltin?: boolean;
  originLocal?: boolean;
  readonly?: boolean;
}): boolean {
  if (input.originBuiltin) return false;
  if (input.readonly) return false;
  return true;
}

/** Local discovered skills live outside the profile install root; server deleteSkill only removes profile skills. */
export function skillUninstallUsesDesktopScan(input: { originLocal?: boolean }): boolean {
  return Boolean(input.originLocal);
}
