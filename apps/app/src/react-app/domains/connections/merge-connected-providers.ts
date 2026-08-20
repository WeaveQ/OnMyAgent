/**
 * Single merge path for Settings → Models and any consumer that needs the
 * union of OpenCode SDK provider.list rows + agent-management inventory.
 *
 * Pure: no React, no IPC. Callers pass blocked-id checks.
 */
import type { ProviderListItem } from "../../../app/types";
import type { AgentManagementManagedProvider } from "../../../app/lib/desktop";
import {
  orderConnectedProviders,
  readConnectedProviderOrderIds,
} from "./order-connected-providers";

export type MergedConnectedProviderSource = "env" | "api" | "config" | "custom";

export type MergedConnectedProvider = {
  id: string;
  name: string;
  source?: MergedConnectedProviderSource;
  managedBy?: "opencode";
  /**
   * Present only when known and > 0 so list rows can paint without catalog size.
   */
  modelCount?: number;
};

export function normalizeMergedProviderSource(
  source: ProviderListItem["source"] | undefined | null,
): MergedConnectedProviderSource | undefined {
  if (
    source === "env" ||
    source === "api" ||
    source === "config" ||
    source === "custom"
  ) {
    return source;
  }
  return undefined;
}

/** Count models on an OpenCode managed-provider inventory row. */
export function countOpenCodeProviderModels(provider: {
  models?: ReadonlyArray<{ id?: string } | string> | null;
  settingsConfig?: Record<string, unknown> | null;
}): number {
  if (Array.isArray(provider.models) && provider.models.length > 0) {
    return provider.models.length;
  }
  const settings = provider.settingsConfig;
  if (!settings || typeof settings !== "object") return 0;
  const models = settings.models;
  if (models && typeof models === "object" && !Array.isArray(models)) {
    return Object.keys(models).length;
  }
  if (Array.isArray(models)) return models.length;
  return 0;
}

export type MergeConnectedProvidersInput = {
  /** SDK provider.list rows (already filtered or full list). */
  sdkProviders: ReadonlyArray<
    Pick<ProviderListItem, "id" | "name" | "source" | "models">
  >;
  /** Connected provider ids from the same list response / store. */
  connectedIds: ReadonlyArray<string> | ReadonlySet<string>;
  /** Custom OpenCode inventory (may be empty while still loading). */
  managedProviders?: ReadonlyArray<
    Pick<
      AgentManagementManagedProvider,
      "id" | "name" | "livePresent" | "models" | "settingsConfig"
    >
  >;
  /** Return true when a provider must not appear (desktop policy). */
  isBlocked?: (providerId: string) => boolean;
};

/**
 * Merge SDK connected providers with OpenCode managed inventory.
 * Managed rows with the same id overwrite source/managedBy (custom + opencode).
 */
export function mergeConnectedProviders(
  input: MergeConnectedProvidersInput,
): MergedConnectedProvider[] {
  const connected =
    input.connectedIds instanceof Set
      ? input.connectedIds
      : new Set(input.connectedIds);
  const isBlocked = input.isBlocked ?? (() => false);
  const byId = new Map<string, MergedConnectedProvider>();

  for (const provider of input.sdkProviders) {
    if (!connected.has(provider.id) || isBlocked(provider.id)) continue;
    const modelCount = Object.keys(provider.models ?? {}).length;
    byId.set(provider.id, {
      id: provider.id,
      name: provider.name ?? provider.id,
      source: normalizeMergedProviderSource(provider.source),
      ...(modelCount > 0 ? { modelCount } : {}),
    });
  }

  for (const provider of input.managedProviders ?? []) {
    if (!provider.livePresent || isBlocked(provider.id)) continue;
    const modelCount = countOpenCodeProviderModels(provider);
    byId.set(provider.id, {
      id: provider.id,
      name: provider.name || provider.id,
      source: "custom",
      managedBy: "opencode",
      ...(modelCount > 0 ? { modelCount } : {}),
    });
  }

  return [...byId.values()];
}

export type ListOrderedConnectedProvidersInput = MergeConnectedProvidersInput & {
  orderIds?: ReadonlyArray<string>;
};

/** Settings → Models and session picker share this ordered list. */
export function listOrderedConnectedProviders(
  input: ListOrderedConnectedProvidersInput,
): MergedConnectedProvider[] {
  return orderConnectedProviders(
    mergeConnectedProviders(input),
    input.orderIds ?? readConnectedProviderOrderIds(),
  );
}

/** Stable id set for Settings vs Session catalog consistency checks. */
export function connectedProviderIdSet(
  providers: ReadonlyArray<{ id: string }>,
): Set<string> {
  return new Set(providers.map((p) => p.id));
}
