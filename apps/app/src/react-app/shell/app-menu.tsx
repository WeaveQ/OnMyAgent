/** @jsxImportSource react */
import type { ReactNode } from "react";

import { KeymapDispatcher } from "./keymap-dispatcher";
import { QuickCaptureSubmitBridge } from "./quick-capture-submit-bridge";

/**
 * Hosts the unified keymap dispatcher (settings, sidebar, new task, search,
 * app snapshot) inside the router tree. Native Electron menu events are
 * handled by KeymapDispatcher. Quick-capture submit is bridged here so it
 * still works when SessionRoute is unmounted (e.g. settings).
 */
export function AppMenuProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <KeymapDispatcher />
      <QuickCaptureSubmitBridge />
      {children}
    </>
  );
}
