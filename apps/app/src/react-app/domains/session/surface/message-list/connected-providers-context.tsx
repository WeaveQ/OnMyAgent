/** @jsxImportSource react */
import { createContext, useContext, useMemo, type ReactNode } from "react";

const ConnectedProviderIdsContext = createContext<ReadonlySet<string> | null>(null);

/**
 * Live connected OpenCode provider IDs for transcript chrome.
 * Used only for display (e.g. "removed" badge on historical model labels).
 * Null means "unknown" — do not treat models as removed.
 *
 * Session/expert routes pass `[]` until the model picker opens (catalog is
 * deferred on cold enter). An empty list is therefore unknown, not "every
 * provider was removed".
 */
export function resolveConnectedProviderIds(
  providerIds: readonly string[] | null | undefined,
): ReadonlySet<string> | null {
  if (!providerIds) return null;
  const next = new Set(providerIds.map((id) => id.trim()).filter(Boolean));
  return next.size > 0 ? next : null;
}

export function isTranscriptModelRemoved(input: {
  modelId: string | null | undefined;
  providerId: string | null | undefined;
  connectedProviderIds: ReadonlySet<string> | null | undefined;
}): boolean {
  const modelId = input.modelId?.trim() ?? "";
  const providerId = input.providerId?.trim() ?? "";
  const connected = input.connectedProviderIds;
  if (!modelId || !providerId || !connected || connected.size === 0) return false;
  return !connected.has(providerId);
}

export function ConnectedProviderIdsProvider(props: {
  providerIds: readonly string[] | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo(
    () => resolveConnectedProviderIds(props.providerIds),
    [props.providerIds],
  );

  return (
    <ConnectedProviderIdsContext.Provider value={value}>
      {props.children}
    </ConnectedProviderIdsContext.Provider>
  );
}

export function useConnectedProviderIds(): ReadonlySet<string> | null {
  return useContext(ConnectedProviderIdsContext);
}
