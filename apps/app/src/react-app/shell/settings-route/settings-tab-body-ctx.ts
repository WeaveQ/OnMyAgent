/**
 * Context bag for SettingsTabBody. Host-owned fields are threaded through as
 * a single object so the tab switch stays a pure view mapping.
 *
 * Typed as an open host bag without the forbidden `any` keyword; property
 * access is narrowed at use sites or via the host object shape from render.
 */
import type { SettingsTab } from "../../../app/types";

export type SettingsTabBodyCtx = {
  tab: SettingsTab;
} & Record<string, unknown>;
