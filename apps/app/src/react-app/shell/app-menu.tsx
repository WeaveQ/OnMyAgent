/** @jsxImportSource react */
import type { ReactNode } from "react";

import { KeymapDispatcher } from "./keymap-dispatcher";

/**
 * Hosts the unified keymap dispatcher (settings, sidebar, new task, search,
 * app snapshot) inside the router tree. Native Electron menu events are
 * handled by KeymapDispatcher.
 */
export function AppMenuProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <KeymapDispatcher />
      {children}
    </>
  );
}
