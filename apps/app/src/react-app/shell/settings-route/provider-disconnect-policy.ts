/**
 * Whether the AI providers list may show Unplug for a row.
 * OpenCode custom providers use edit/delete; env/config/custom are not OAuth rows.
 */
export function canDisconnectProviderRow(input: {
  provider: { id: string; managedBy?: string | null; source?: string | null };
  opencodeInventoryReady: boolean;
}): boolean {
  const { provider, opencodeInventoryReady } = input;
  // OpenCode custom providers use edit/delete, not disconnect.
  if (provider.managedBy === "opencode") return false;
  // Built-in free OpenCode Zen: disconnect disables it in workspace config.
  if (provider.id === "opencode") return true;
  // Env / config / custom entries are not "disconnectable" OAuth rows.
  if (
    provider.source === "env" ||
    provider.source === "config" ||
    provider.source === "custom"
  ) {
    return false;
  }
  // If inventory is still loading, avoid flashing Unplug on rows that will
  // become edit/delete once managedBy is set.
  if (!opencodeInventoryReady) {
    return false;
  }
  return true;
}
