/**
 * Workspace disabled_providers mutation helpers for provider disconnect
 * (including built-in OpenCode Zen free provider).
 *
 * Pure string/config transforms + small helpers — store wires file I/O.
 */
export function normalizeDisabledProviders(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

export function nextDisabledProvidersList(
  current: ReadonlyArray<string>,
  providerId: string,
  disabled: boolean,
): string[] {
  const resolved = providerId.trim();
  if (!resolved) return [...current];
  if (disabled) {
    return [...current.filter((entry) => entry !== resolved), resolved];
  }
  return current.filter((entry) => entry !== resolved);
}

export function disabledProvidersListsEqual(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/** Built-in free OpenCode Zen has no credentials — disconnect = disable in config. */
export function isBuiltinOpenCodeZenProvider(providerId: string): boolean {
  return providerId.trim() === "opencode";
}
