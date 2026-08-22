/**
 * Workspace disabled_providers mutation helpers for provider disconnect
 * (including built-in OpenCode Zen free provider).
 *
 * List transforms stay pure; live OpenCode config patch is I/O used by store.
 */

import { unwrap } from "../../../../app/lib/opencode";
import type { Client } from "../../../../app/types";

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

/** Patch running OpenCode; only mark reload required when the live update fails. */
export async function applyDisabledProvidersLive(
  c: Client | null,
  nextDisabled: string[],
  markOpencodeConfigReloadRequired: () => void,
): Promise<void> {
  let appliedLive = false;
  if (c) {
    try {
      const config = unwrap(await c.config.get()) as Record<string, unknown>;
      const nextConfig = { ...config };
      if (nextDisabled.length) {
        nextConfig.disabled_providers = nextDisabled;
      } else {
        delete nextConfig.disabled_providers;
      }
      await c.config.update({ config: nextConfig });
      appliedLive = true;
    } catch {
      appliedLive = false;
    }
  }
  if (!appliedLive) {
    markOpencodeConfigReloadRequired();
  }
}
