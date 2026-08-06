/**
 * Whether OnMyCompany is configured (connected session present).
 * Used to gate the primary-rail Company shortcut — hide until Settings → Workspace → Company is connected.
 */
import { useEffect, useState } from "react";

import { isDesktopRuntime } from "../../../../app/utils";

const POLL_MS = 15_000;

export function useCompanyConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      setConnected(false);
      return;
    }
    let cancelled = false;

    const tick = () => {
      void import("../../../../app/lib/desktop")
        .then(({ desktopBridge }) => desktopBridge.companyCatalog())
        .then((raw) => {
          if (cancelled) return;
          const catalog = raw as { connected?: boolean } | null;
          setConnected(Boolean(catalog && catalog.connected === true));
        })
        .catch(() => {
          if (!cancelled) setConnected(false);
        });
    };

    tick();
    const id = window.setInterval(tick, POLL_MS);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    // Settings connect/disconnect may write durable store; re-check on visibility.
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return connected;
}
