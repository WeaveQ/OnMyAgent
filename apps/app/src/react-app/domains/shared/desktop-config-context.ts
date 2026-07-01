/** @jsxImportSource react */
import { createContext, use } from "react";

import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import type { DenDesktopConfig } from "../../../app/lib/den";

export type DesktopConfigStore = {
  config: DenDesktopConfig;
  loading: boolean;
  refresh: () => Promise<void>;
  checkRestriction: DesktopAppRestrictionChecker;
};

export const DesktopConfigContext = createContext<DesktopConfigStore | undefined>(
  undefined,
);

export function useDesktopConfig(): DesktopConfigStore {
  const context = use(DesktopConfigContext);
  if (!context) {
    throw new Error("useDesktopConfig must be used within a DesktopConfigProvider");
  }
  return context;
}

export function useOrgRestrictions(): DenDesktopConfig {
  return useDesktopConfig().config;
}

export function useCheckDesktopRestriction(): DesktopAppRestrictionChecker {
  return useDesktopConfig().checkRestriction;
}

export function useDesktopRestriction(
  restriction: Parameters<DesktopAppRestrictionChecker>[0]["restriction"],
): boolean {
  return useDesktopConfig().checkRestriction({ restriction });
}
