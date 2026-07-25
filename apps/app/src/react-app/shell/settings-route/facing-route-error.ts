/**
 * Product-facing route error state for settings banners + recovery actions.
 */
import { useCallback, useState } from "react";

import {
  presentUserError,
  type UserErrorActionId,
  type UserErrorScenario,
} from "../../kernel/user-error";

export function useFacingRouteError() {
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeErrorAction, setRouteErrorAction] =
    useState<UserErrorActionId | null>(null);

  const setFacingRouteError = useCallback(
    (raw: string | null, forcedScenario?: UserErrorScenario) => {
      if (!raw && !forcedScenario) {
        setRouteError(null);
        setRouteErrorAction(null);
        return;
      }
      const copy = presentUserError(raw, forcedScenario);
      setRouteError(`${copy.title}. ${copy.body}`);
      setRouteErrorAction(copy.primaryAction);
    },
    [],
  );

  const clearFacingRouteError = useCallback(() => {
    setRouteError(null);
    setRouteErrorAction(null);
  }, []);

  return {
    routeError,
    routeErrorAction,
    setFacingRouteError,
    clearFacingRouteError,
    setRouteError,
    setRouteErrorAction,
  };
}
