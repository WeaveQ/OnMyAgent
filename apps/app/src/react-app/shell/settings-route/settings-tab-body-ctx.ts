/**
 * Context bag for SettingsTabBody. Typed loosely so the host can pass through
 * store snapshots without re-declaring every domain type here.
 */
import type { ReactNode } from "react";
import type { SettingsTab } from "../../../app/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingsTabBodyCtx = {
  tab: SettingsTab;
  [key: string]: any;
};
