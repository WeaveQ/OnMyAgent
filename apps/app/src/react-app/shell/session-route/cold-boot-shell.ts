/**
 * Snapshot whether this session-route mount began during app cold boot.
 * Extracted from render.tsx to satisfy the file-size baseline.
 */
import { useState } from "react";

import { useBootState } from "../boot-state";

/**
 * True when mount began while the boot overlay / engine was still settling.
 * Settings "Back to app" remounts with phase already ready + routeReady, so
 * first-screen skeleton stays off.
 */
export function useColdBootShell(): boolean {
  const { phase, routeReady } = useBootState();
  const [coldBootShell] = useState(
    !routeReady || (phase !== "ready" && phase !== "error"),
  );
  return coldBootShell;
}
