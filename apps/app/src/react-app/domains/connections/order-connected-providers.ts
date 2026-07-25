/**
 * Pure helpers for settings connected-provider display order.
 * Preference storage lives in session-memory; this module only reorders lists.
 */

export type OrderableProvider = { id: string };

/**
 * Apply a stored provider id order. Known ids keep preference order; any
 * providers not in the preference list are appended (stable merge order).
 */
export function orderConnectedProviders<T extends OrderableProvider>(
  providers: ReadonlyArray<T>,
  orderIds: ReadonlyArray<string>,
): T[] {
  if (providers.length <= 1) return [...providers];
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const rawId of orderIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    const match = byId.get(id);
    if (!match) continue;
    ordered.push(match);
    seen.add(id);
  }
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    ordered.push(provider);
  }
  return ordered;
}

/**
 * Move a provider one step up or down in the ordered id list.
 * Returns a full order id array suitable for persistence.
 */
export function moveConnectedProviderInOrder(
  currentOrder: ReadonlyArray<string>,
  providerIdsPresent: ReadonlyArray<string>,
  providerId: string,
  direction: "up" | "down",
): string[] {
  const base = orderConnectedProviders(
    providerIdsPresent.map((id) => ({ id })),
    currentOrder,
  ).map((item) => item.id);
  const index = base.indexOf(providerId);
  if (index < 0) return base;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= base.length) return base;
  const next = [...base];
  const tmp = next[index]!;
  next[index] = next[swapWith]!;
  next[swapWith] = tmp;
  return next;
}
