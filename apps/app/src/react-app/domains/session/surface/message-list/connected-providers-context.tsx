/** @jsxImportSource react */
import { createContext, useContext, useMemo, type ReactNode } from "react";

const ConnectedProviderIdsContext = createContext<ReadonlySet<string> | null>(null);

/**
 * Live connected OpenCode provider IDs for transcript chrome.
 * Used only for display (e.g. "removed" badge on historical model labels).
 * Null means "unknown" — do not treat models as removed.
 */
export function ConnectedProviderIdsProvider(props: {
  providerIds: readonly string[] | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    if (!props.providerIds) return null;
    return new Set(props.providerIds.map((id) => id.trim()).filter(Boolean));
  }, [props.providerIds]);

  return (
    <ConnectedProviderIdsContext.Provider value={value}>
      {props.children}
    </ConnectedProviderIdsContext.Provider>
  );
}

export function useConnectedProviderIds(): ReadonlySet<string> | null {
  return useContext(ConnectedProviderIdsContext);
}
