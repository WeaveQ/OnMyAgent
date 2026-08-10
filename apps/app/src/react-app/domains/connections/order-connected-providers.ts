/**
 * Pure helpers for settings connected-provider display order.
 * Preference storage lives in session-memory; this module only reorders lists.
 */

export type OrderableProvider = {
  id: string;
  /** When present, used for default ordering (custom first). */
  source?: string | null;
};

function isCustomProvider(provider: OrderableProvider): boolean {
  return provider.source === "custom";
}

/**
 * Default display order when the user has not set a preference:
 * custom providers first (stable), then everything else (stable).
 */
export function defaultConnectedProviderOrderIds(
  providers: ReadonlyArray<OrderableProvider>,
): string[] {
  const custom: string[] = [];
  const rest: string[] = [];
  for (const provider of providers) {
    if (isCustomProvider(provider)) custom.push(provider.id);
    else rest.push(provider.id);
  }
  return [...custom, ...rest];
}

/**
 * Apply a stored provider id order. Known ids keep preference order; any
 * providers not in the preference list are appended with custom-first grouping.
 * Empty / missing preference → custom providers first.
 */
export function orderConnectedProviders<T extends OrderableProvider>(
  providers: ReadonlyArray<T>,
  orderIds: ReadonlyArray<string>,
): T[] {
  if (providers.length <= 1) return [...providers];
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const effectiveOrder =
    orderIds.length > 0 ? orderIds : defaultConnectedProviderOrderIds(providers);
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const rawId of effectiveOrder) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    const match = byId.get(id);
    if (!match) continue;
    ordered.push(match);
    seen.add(id);
  }
  // Unknowns not in preference: custom first, then the rest (stable).
  const unknownCustom: T[] = [];
  const unknownRest: T[] = [];
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    if (isCustomProvider(provider)) unknownCustom.push(provider);
    else unknownRest.push(provider);
  }
  ordered.push(...unknownCustom, ...unknownRest);
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

/**
 * Drag-and-drop reorder: move `fromId` so it lands at `toId`'s index.
 * Returns a full order id array suitable for persistence.
 */
export function reorderConnectedProviderIds(
  currentOrder: ReadonlyArray<string>,
  providersPresent: ReadonlyArray<OrderableProvider>,
  fromId: string,
  toId: string,
): string[] {
  const base = orderConnectedProviders(providersPresent, currentOrder).map(
    (item) => item.id,
  );
  const from = base.indexOf(fromId);
  const to = base.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return base;
  const next = [...base];
  const [item] = next.splice(from, 1);
  if (!item) return base;
  next.splice(to, 0, item);
  return next;
}
