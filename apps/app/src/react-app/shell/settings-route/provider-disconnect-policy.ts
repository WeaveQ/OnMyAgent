type OpenCodeListProvider = {
  id: string;
  managedBy?: string | null;
  source?: string | null;
};

export type ProviderRemoveMode = "delete" | "disconnect";

/**
 * Env-backed rows are not removable in-app — credentials live outside App
 * storage. UI shows a weak hint instead of a remove control.
 */
export function isEnvManagedProvider(provider: {
  source?: string | null;
}): boolean {
  return provider.source === "env";
}

/**
 * Whether the AI providers list may clear stored credentials / disable the row
 * (credential disconnect path). Custom/config rows use the delete path instead;
 * env rows are not disconnectable.
 */
export function canDisconnectProviderRow(input: {
  provider: { id: string; managedBy?: string | null; source?: string | null };
  opencodeInventoryReady: boolean;
}): boolean {
  const { provider, opencodeInventoryReady } = input;
  // Editable OpenCode rows use edit + remove(delete), not credential disconnect.
  if (canEditOpenCodeProvider(provider)) return false;
  // Built-in free OpenCode Zen: disconnect disables it in workspace config.
  if (provider.id === "opencode") return true;
  // Env / remaining custom entries are not "disconnectable" OAuth/API rows.
  if (provider.source === "env" || provider.source === "custom") {
    return false;
  }
  // If inventory is still loading, avoid flashing remove on rows that will
  // become edit/delete once managedBy is set.
  if (!opencodeInventoryReady) {
    return false;
  }
  return true;
}

/**
 * Pencil for:
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

/**
 * Unified list action "移除 / Remove": either delete custom/config config or
 * disconnect credentials. Env rows return null (hint only).
 */
export function resolveProviderRemoveMode(input: {
  provider: { id: string; managedBy?: string | null; source?: string | null };
  opencodeInventoryReady: boolean;
}): ProviderRemoveMode | null {
  const { provider } = input;
  if (isEnvManagedProvider(provider)) return null;
  if (canDeleteOpenCodeProvider(provider)) return "delete";
  if (canDisconnectProviderRow(input)) return "disconnect";
  return null;
}

/** True when the row should show the unified remove control. */
export function canRemoveProviderRow(input: {
  provider: { id: string; managedBy?: string | null; source?: string | null };
  opencodeInventoryReady: boolean;
}): boolean {
  return resolveProviderRemoveMode(input) !== null;
}
