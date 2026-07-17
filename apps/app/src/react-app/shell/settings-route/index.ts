/**
 * Settings-route public facade.
 *
 * Logical public modules:
 *   1. model.ts     — workspace/session route model helpers
 *   2. storage.ts   — settings localStorage keys/helpers
 *   3. render.tsx   — SettingsRoute / SettingsSurface composition
 *   4. index.ts     — this facade
 *
 * Implementation details remain in sibling files under this folder.
 * Prefer these entrypoints for new shell call sites.
 */

export {
  SettingsRoute,
  SettingsSurface,
  type SettingsSurfaceProps,
} from "./render";

export * from "./model";
export * from "./storage";
export * from "./sessions";
export * from "./workspace-actions";
export * from "./server-actions";
export * from "./remote-workspace-actions";
export * from "./embedded-path";
export * from "./refs";
