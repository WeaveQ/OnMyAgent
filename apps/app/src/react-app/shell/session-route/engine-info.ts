import { useEffect, useState } from "react";

import { engineInfo, type EngineInfo } from "../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../app/utils";

export function useRouteEngineInfo() {
  const [routeEngineInfo, setRouteEngineInfo] = useState<EngineInfo | null>(null);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let cancelled = false;
    void engineInfo()
      .then((info) => {
        if (!cancelled) setRouteEngineInfo(info as EngineInfo | null);
      })
      .catch(() => {
        if (!cancelled) setRouteEngineInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return routeEngineInfo;
}
