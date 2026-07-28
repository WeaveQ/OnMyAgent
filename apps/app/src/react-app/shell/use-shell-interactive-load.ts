/**
 * First-load vs soft-refresh load scopes for route hosts.
 * After the first successful load, the shell is interactive and must not
 * re-report a full route-session/settings scope (double-load feel).
 */
import { useEffect, useState } from "react";

import { useLoadScope } from "./load-surface";
import type { LoadScopeId } from "./route-load-registry";

export function useShellInteractiveLoad(input: {
  loading: boolean;
  firstLoadScope: LoadScopeId;
  /** When set, soft refreshes report this quieter scope instead of firstLoadScope. */
  softRefreshScope?: LoadScopeId | null;
}): { shellInteractive: boolean } {
  const [shellInteractive, setShellInteractive] = useState(false);
  useEffect(() => {
    if (!input.loading) setShellInteractive(true);
  }, [input.loading]);

  const softScope = input.softRefreshScope ?? null;
  useLoadScope(input.firstLoadScope, input.loading && !shellInteractive);
  // Soft scope always registers with the same id when provided; inactive when
  // not interactive or no soft scope (use firstLoadScope id as inert no-op via active=false).
  useLoadScope(
    softScope ?? input.firstLoadScope,
    softScope != null && input.loading && shellInteractive,
  );

  return { shellInteractive };
}
