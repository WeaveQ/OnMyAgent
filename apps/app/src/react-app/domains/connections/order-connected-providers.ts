/**
 * Connected-provider display order: pure reorder helpers + localStorage
 * preference (shared by Settings → Models and home/session model pickers).
 */

/** Must stay in sync with historical shell session-memory key. */
export const CONNECTED_PROVIDER_ORDER_KEY =
  "onmyagent.react.connectedProviderOrder.v1";

export type OrderableProvider = {
  id: string;
  /** When present, used for default ordering (custom first). */
  source?: string | null;
};

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === "") {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors (quota, privacy modes, etc.)
  }
}

const EMPTY_CONNECTED_PROVIDER_ORDER: string[] = [];
const connectedProviderOrderListeners = new Set<() => void>();
let connectedProviderOrderSnapshot: string[] = EMPTY_CONNECTED_PROVIDER_ORDER;
let connectedProviderOrderSnapshotReady = false;

export function readConnectedProviderOrderIds(): string[] {
  const raw = safeGet(CONNECTED_PROVIDER_ORDER_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed ? [trimmed] : [];
    });
  } catch {
    return [];
  }
}

function refreshConnectedProviderOrderSnapshot(): string[] {
  const next = readConnectedProviderOrderIds();
  connectedProviderOrderSnapshot =
    next.length === 0 ? EMPTY_CONNECTED_PROVIDER_ORDER : next;
  connectedProviderOrderSnapshotReady = true;
  return connectedProviderOrderSnapshot;
}

export function getConnectedProviderOrderSnapshot(): string[] {
  if (!connectedProviderOrderSnapshotReady) {
    return refreshConnectedProviderOrderSnapshot();
  }
  return connectedProviderOrderSnapshot;
}

export function subscribeConnectedProviderOrder(onStoreChange: () => void): () => void {
  connectedProviderOrderListeners.add(onStoreChange);
  return () => {
    connectedProviderOrderListeners.delete(onStoreChange);
  };
}

export function writeConnectedProviderOrderIds(ids: string[]): void {
  const normalized = ids.flatMap((id) => {
    const trimmed = id.trim();
    return trimmed ? [trimmed] : [];
  });
  safeSet(
    CONNECTED_PROVIDER_ORDER_KEY,
    normalized.length ? JSON.stringify(normalized) : null,
  );
  connectedProviderOrderSnapshot =
    normalized.length === 0 ? EMPTY_CONNECTED_PROVIDER_ORDER : normalized;
  connectedProviderOrderSnapshotReady = true;
  for (const listener of connectedProviderOrderListeners) listener();
}

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
