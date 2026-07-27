/**
 * Whether the AI providers list may show Unplug for a row.
 * OpenCode custom/config providers use edit/delete; env rows are not OAuth disconnect.
 */
export function canDisconnectProviderRow(input: {
  provider: { id: string; managedBy?: string | null; source?: string | null };
  opencodeInventoryReady: boolean;
}): boolean {
  const { provider, opencodeInventoryReady } = input;
  // Editable OpenCode rows use pencil/trash, not Unplug.
  if (canEditOpenCodeProvider(provider)) return false;
  // Built-in free OpenCode Zen: disconnect disables it in workspace config.
  if (provider.id === "opencode") return true;
  // Env / remaining custom entries are not "disconnectable" OAuth rows.
  if (provider.source === "env" || provider.source === "custom") {
    return false;
  }
  // If inventory is still loading, avoid flashing Unplug on rows that will
  // become edit/delete once managedBy is set.
  if (!opencodeInventoryReady) {
    return false;
  }
  return true;
}

type OpenCodeListProvider = {
  id: string;
  managedBy?: string | null;
  source?: string | null;
};

/**
 * Pencil/trash for:
 * - Agent-management custom providers (`managedBy: "opencode"`)
 * - Workspace config installs such as Ollama from connectors (`source: "config"`)
 * Never for free OpenCode Zen (`id: "opencode"`).
 */
export function canEditOpenCodeProvider(provider: OpenCodeListProvider): boolean {
  if (provider.id === "opencode") return false;
  if (provider.managedBy === "opencode") return true;
  // Connectors "add to workspace" writes opencode.provider via patchConfig and
  // surfaces as source=config without managedBy — still editable as a local provider.
  if (provider.source === "config") return true;
  if (provider.source === "custom") return true;
  return false;
}

export function canDeleteOpenCodeProvider(provider: OpenCodeListProvider): boolean {
  // Same surface as edit: config installs (Ollama) and managed custom rows.
  return canEditOpenCodeProvider(provider);
}
